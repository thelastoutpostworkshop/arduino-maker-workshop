import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { test } from 'node:test';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { setupAiClient } from '../clientSetup';
import { createAiIpcServer, type AiIpcServer } from '../ipcServer';

interface LaunchDefinition {
    command: string;
    args: string[];
    env: Record<string, string>;
}

interface RpcFrame {
    jsonrpc: string;
    id?: unknown;
    error?: unknown;
    result?: {
        tools?: { name: string }[];
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
    };
}

async function bounded<T>(pending: Promise<T>, message: string, milliseconds = 5000): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(message)), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

for (const client of ['codex', 'claude'] as const) {
    test(`${client} generated configuration runs the standalone bridge without Node on PATH`, { timeout: 20000 }, async t => {
        // An explicit override lets the same test exercise a desktop VS Code runtime.
        // Never discover a CLI wrapper or copy the test runner's execArgv.
        const runtime = process.env.AMW_TEST_VSCODE_RUNTIME || process.execPath;
        assert.ok(path.isAbsolute(runtime), 'The runtime must be an absolute executable path');
        const temporaryRoot = await fs.realpath(os.tmpdir());
        const directory = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'amw-runtime-')));
        let child: ChildProcessWithoutNullStreams | undefined;
        let lines: Interface | undefined;
        let server: AiIpcServer | undefined;
        let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
        t.after(async () => {
            try {
                if (child && exited) {
                    child.stdin.end();
                    try { await bounded(exited, 'Bridge did not exit after stdin closed', 2000); }
                    catch {
                        child.kill();
                        await bounded(exited, 'Bridge did not stop during cleanup', 2000);
                    }
                }
            } finally {
                lines?.close();
                try { await bounded(server?.dispose() ?? Promise.resolve(), 'IPC cleanup did not finish'); }
                finally {
                    const resolved = await fs.realpath(directory);
                    assert.equal(resolved, directory);
                    assert.equal(path.dirname(resolved), temporaryRoot);
                    assert.ok(path.basename(resolved).startsWith('amw-runtime-'));
                    await fs.rm(resolved, { recursive: true, force: true });
                }
            }
        });

        const sketchDirectory = path.join(directory, 'Current Sketch');
        await fs.mkdir(sketchDirectory);
        const sketchPath = await fs.realpath(sketchDirectory);
        const sessionDirectory = path.join(directory, 'ai-bridge');
        const launcher = path.join(directory, 'standalone launcher.cjs');
        await fs.copyFile(path.join(process.cwd(), 'build', 'aiBridge.cjs'), launcher);
        const calls: string[] = [];
        server = await createAiIpcServer({
            sessionDirectory, sketchPath, isTrusted: () => true,
            handler: async (name, input) => {
                assert.equal(name, 'get_project_context');
                calls.push(name);
                return { schemaVersion: 1, sketchPath: input.sketchPath, ready: true, source: 'runtime-test' };
            },
        });
        const intended: LaunchDefinition = {
            command: runtime,
            args: [launcher, '--session-dir', sessionDirectory],
            env: { ELECTRON_RUN_AS_NODE: '1' },
        };
        const setup = await setupAiClient(client, intended, { homeDirectory: directory, environment: {} });
        assert.equal(setup.changed, true);
        const configText = await fs.readFile(setup.configPath, 'utf8');
        const configuration = client === 'codex'
            ? getStaticTOMLValue(parseTOML(configText)) : JSON.parse(configText);
        const definition = (configuration as Record<string, Record<string, LaunchDefinition>>)[
            client === 'codex' ? 'mcp_servers' : 'mcpServers'
        ].arduino_maker_workshop;
        assert.equal(definition.command, runtime);
        assert.deepEqual(definition.args, intended.args);
        assert.equal(definition.env.ELECTRON_RUN_AS_NODE, '1');

        // Remove every case variant before merging: Windows treats Path/PATH as one key.
        const environment: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env)
            .filter(([key]) => !['PATH', 'NODE_OPTIONS', 'VSCODE_INSPECTOR_OPTIONS'].includes(key.toUpperCase())));
        Object.assign(environment, definition.env, { PATH: '', NODE_OPTIONS: '' });
        child = spawn(definition.command, definition.args, {
            cwd: directory, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
        });
        const running = child;
        const replies = new Map<number, { resolve(frame: RpcFrame): void; reject(error: Error): void }>();
        let failure: Error | undefined;
        let stderr = '';
        const fail = (error: Error) => {
            failure ??= error;
            for (const reply of replies.values()) { reply.reject(error); }
            replies.clear();
        };
        running.stderr.on('data', chunk => {
            stderr += chunk.toString();
            if (stderr.length > 65536) { fail(new Error('Bridge exceeded the diagnostic output limit')); running.kill(); }
        });
        running.on('error', fail);
        running.stdin.on('error', fail);
        exited = new Promise(resolve => running.once('close', (code, signal) => {
            if (replies.size) { fail(new Error(`Bridge closed before replying; stderr=${stderr}`)); }
            resolve({ code, signal });
        }));
        lines = createInterface({ input: running.stdout });
        lines.on('line', line => {
            try {
                const frame = JSON.parse(line) as RpcFrame;
                assert.equal(frame.jsonrpc, '2.0', 'stdout must contain only JSON-RPC frames');
                assert.equal(typeof frame.id, 'number', 'This fixture expects only responses');
                const reply = replies.get(frame.id as number);
                assert.ok(reply, 'The bridge returned an unexpected response');
                reply.resolve(frame);
            } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        });
        let nextId = 1;
        const request = async (method: string, params: unknown = {}): Promise<RpcFrame> => {
            if (failure) { throw failure; }
            const id = nextId++;
            const response = new Promise<RpcFrame>((resolve, reject) => replies.set(id, { resolve, reject }));
            running.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
            try {
                const frame = await bounded(response, `No bridge response to ${method}`);
                assert.equal(frame.error, undefined, JSON.stringify(frame));
                return frame;
            } finally { replies.delete(id); }
        };

        await request('initialize', {
            protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: `${client}-runtime-test`, version: 'test' },
        });
        running.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const tools = await request('tools/list');
        assert.deepEqual(tools.result?.tools?.map(tool => tool.name).sort(), [
            'compile_sketch', 'decode_esp32_backtrace', 'get_board_details', 'get_project_context', 'install_library', 'list_boards', 'list_connected_sketches',
            'list_dependencies', 'list_examples', 'list_ports', 'search_libraries',
        ]);
        const discovery = await request('tools/call', { name: 'list_connected_sketches', arguments: {} });
        assert.notEqual(discovery.result?.isError, true, JSON.stringify(discovery));
        assert.deepEqual(discovery.result?.structuredContent?.sketches, [{ sketchPath, sessionCount: 1 }]);
        const context = await request('tools/call', { name: 'get_project_context', arguments: { sketchPath } });
        assert.notEqual(context.result?.isError, true, JSON.stringify(context));
        assert.deepEqual(context.result?.structuredContent, { schemaVersion: 1, sketchPath, ready: true, source: 'runtime-test' });
        assert.deepEqual(calls, ['get_project_context']);

        running.stdin.end();
        assert.deepEqual(await bounded(exited, 'Bridge did not exit cleanly after stdin closed'), { code: 0, signal: null });
        assert.equal(failure, undefined);
        assert.equal(stderr, '', 'The launcher must not emit unexpected diagnostics');
    });
}
