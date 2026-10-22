import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { test, type TestContext } from 'node:test';
import { createAiIpcServer, type AiIpcServer } from '../ipcServer';
import type { AiToolName } from '../contracts';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(complete => { resolve = complete; });
    return { promise, resolve };
}

async function bounded<T>(pending: Promise<T>, message: string, milliseconds = 5000): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(message)), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

/** A real packaged stdio process stays alive while the simulated VS Code sessions change. */
async function fixture(t: TestContext) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-reconnect-'));
    await fs.mkdir(path.join(directory, 'Blink'));
    const sketchPath = await fs.realpath(path.join(directory, 'Blink'));
    const foreignSketchPath = path.join(directory, 'OtherSketch');
    await fs.mkdir(foreignSketchPath);
    const sessionDirectory = path.join(directory, 'ai-bridge');
    const launcher = path.join(directory, 'standalone-launcher.cjs');
    await fs.copyFile(path.join(process.cwd(), 'build', 'aiBridge.cjs'), launcher);
    const args = [launcher, '--session-dir', sessionDirectory];
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const servers: AiIpcServer[] = [];
    const replies = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    let stderr = '';
    let nextId = 1;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdin.on('error', () => { /* A premature launcher exit is reported through pending requests. */ });
    const exited = new Promise<void>(resolve => child.once('close', () => {
        for (const pending of replies.values()) {
            pending.reject(new Error(`Bridge exited before replying; stderr=${stderr}`));
        }
        replies.clear();
        resolve();
    }));
    child.on('error', error => {
        for (const pending of replies.values()) { pending.reject(error); }
        replies.clear();
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
        let frame: any;
        try { frame = JSON.parse(line); } catch {
            for (const pending of replies.values()) { pending.reject(new Error('Bridge emitted non-JSON stdout')); }
            return;
        }
        if (typeof frame.id === 'number') { replies.get(frame.id)?.resolve(frame); }
    });
    t.after(async () => {
        try {
            child.stdin.end();
            try { await bounded(exited, 'Bridge did not close after stdin ended', 2000); }
            catch { child.kill(); await bounded(exited, 'Bridge did not exit after teardown', 2000); }
            await bounded(Promise.all(servers.map(server => server.dispose())), 'Session teardown did not finish');
        } finally {
            lines.close();
            await fs.rm(directory, { recursive: true, force: true });
        }
        assert.equal(stderr, '', 'Reconnectable launcher must keep startup diagnostics out of stderr');
    });
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
    const request = async (method: string, params: unknown = {}) => {
        const id = nextId++;
        const reply = new Promise<any>((resolve, reject) => { replies.set(id, { resolve, reject }); });
        send({ jsonrpc: '2.0', id, method, params });
        try { return await bounded(reply, `No bridge response for ${method}; stderr=${stderr}`); }
        finally { replies.delete(id); }
    };
    const initialize = await request('initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reconnection-test', version: 'test' }
    });
    assert.equal(initialize.error, undefined, JSON.stringify(initialize));
    assert.ok(initialize.result.instructions.includes('list_connected_sketches'), 'Initialization explains how to select a sketch without requiring a live session');
    assert.equal(initialize.result.instructions.includes(sketchPath), false, 'The global launcher is not bound to one sketch');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const connect = async (label: string, options: { sketchPath?: string; waitForAbort?: boolean } = {}) => {
        const calls: AiToolName[] = [];
        const started = deferred();
        const aborted = deferred();
        const server = await createAiIpcServer({
            sessionDirectory, sketchPath: options.sketchPath ?? sketchPath, isTrusted: () => true,
            handler: async (name, input, signal) => {
                calls.push(name);
                if (name === 'compile_sketch' && options.waitForAbort) {
                    started.resolve();
                    await new Promise<void>(resolve => {
                        const onAbort = () => { aborted.resolve(); resolve(); };
                        if (signal.aborted) { onAbort(); }
                        else { signal.addEventListener('abort', onAbort, { once: true }); }
                    });
                    return { session: label, status: 'canceled' };
                }
                return { session: label, sketchPath: input.sketchPath, status: 'success' };
            }
        });
        servers.push(server);
        return { server, calls, started: started.promise, aborted: aborted.promise };
    };
    const call = (name: AiToolName = 'get_project_context') => request('tools/call', { name, arguments: { sketchPath } });
    return { sketchPath, foreignSketchPath, request, call, connect };
}

function assertToolError(frame: any, code: string) {
    assert.equal(frame.error, undefined, JSON.stringify(frame));
    assert.equal(frame.result.isError, true, JSON.stringify(frame));
    assert.equal(frame.result.structuredContent.error.code, code);
    assert.ok(frame.result.structuredContent.error.message.length > 0);
}

test('packaged bridge starts disconnected, reconnects on later calls, and never replays interrupted compilation', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const listed = await f.request('tools/list');
    assert.deepEqual(listed.result.tools.map((tool: any) => tool.name).sort(), ['compile_sketch', 'get_project_context', 'list_boards', 'list_connected_sketches', 'list_dependencies', 'list_ports']);
    const unavailable = await f.call();
    assertToolError(unavailable, 'SESSION_UNAVAILABLE');
    assert.match(unavailable.result.structuredContent.error.message, /VS Code|connect/i);

    const first = await f.connect('session-A', { waitForAbort: true });
    assert.equal((await f.call()).result.structuredContent.session, 'session-A');
    const compile = f.call('compile_sketch');
    await bounded(first.started, 'Compilation never reached session A');
    // A replacement already exists when A disappears, making an accidental retry observable.
    const replacement = await f.connect('session-B');
    await first.server.dispose();
    await bounded(first.aborted, 'Disconnect did not abort the owning compile');
    assertToolError(await compile, 'SESSION_UNAVAILABLE');
    assert.deepEqual(first.calls, ['get_project_context', 'compile_sketch']);
    assert.deepEqual(replacement.calls, [], 'Interrupted work must not be replayed into the new session');

    assert.equal((await f.call()).result.structuredContent.session, 'session-B');
    assert.deepEqual(replacement.calls, ['get_project_context']);
    await replacement.server.dispose();
    assertToolError(await f.call(), 'SESSION_UNAVAILABLE');
    assert.equal((await f.request('tools/list')).result.tools.length, 6, 'Session loss does not terminate the MCP process');
});

test('packaged bridge does not send operations to a different sketch than requested', { timeout: 20000 }, async t => {
    const f = await fixture(t);
    const foreign = await f.connect('foreign', { sketchPath: f.foreignSketchPath });
    assertToolError(await f.call(), 'SESSION_UNAVAILABLE');
    assert.deepEqual(foreign.calls, []);
    const matching = await f.connect('matching');
    assert.equal((await f.call()).result.structuredContent.session, 'matching');
    assert.deepEqual(matching.calls, ['get_project_context']);
    assert.deepEqual(foreign.calls, [], 'A foreign session must never receive sketch operations');
});

test('packaged bridge rejects multiple live sessions for the same sketch and recovers when one disconnects', { timeout: 20000 }, async t => {
    const f = await fixture(t);
    const first = await f.connect('first');
    assert.equal((await f.call()).result.structuredContent.session, 'first');
    first.calls.length = 0;
    const duplicate = await f.connect('duplicate');
    assertToolError(await f.call('compile_sketch'), 'AMBIGUOUS_SESSION');
    assert.deepEqual(first.calls, [], 'Ambiguous resolution must not invoke the previously used session');
    assert.deepEqual(duplicate.calls, [], 'Ambiguous resolution must not invoke the new session');
    await duplicate.server.dispose();
    assert.equal((await f.call()).result.structuredContent.session, 'first');
    assert.deepEqual(first.calls, ['get_project_context']);
});
