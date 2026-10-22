import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { createAiIpcServer } from '../ipcServer';
import { createAiOperationHandler } from '../operations';
import { inspectProject } from '../projectInspection';
import { runProcess } from '../processRunner';
import { collectSensitiveValues } from '../redaction';

async function fixture() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-package-'));
    const sketchPath = path.join(directory, 'Blink');
    await fs.mkdir(path.join(sketchPath, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(sketchPath, 'Blink.ino'), 'void setup() {}\nvoid loop() {}\n');
    await fs.writeFile(path.join(sketchPath, '.vscode', 'arduino.json'), JSON.stringify({ board: 'arduino:avr:uno' }));
    const launcher = path.join(directory, 'standalone-launcher.cjs');
    await fs.copyFile(path.join(process.cwd(), 'build', 'aiBridge.cjs'), launcher);
    let approval = true;
    let mode: 'success' | 'failure' | 'waiting' = 'success';
    let compiles = 0;
    let activeCompile: ReturnType<typeof runProcess> | undefined;
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const handler = createAiOperationHandler({
        isTrusted: () => true, activeSketchPath: () => sketchPath, isReady: () => true,
        inspect: inspectProject, cliInfo: () => ({ executable: 'simulated-arduino-cli', version: 'test' }),
        hasUnsavedSketchDocuments: () => false, revision: () => 0, confirmCompile: async () => approval,
        discover: async kind => ({ kind, entries: [] }), invalidateBuild: () => {},
        compile: async (target, signal, progress) => {
            compiles++;
            progress({ message: 'Simulated extension compiler starting.' });
            const code = mode === 'success' ? 'console.log("compiled");' : mode === 'failure'
                ? 'console.error("fixture compile failure"); process.exitCode=2;' : 'console.log("ready"); setInterval(()=>{},1000);';
            const running = runProcess(process.execPath, ['-e', code], {
                signal, maxOutputBytes: 64 * 1024, sensitiveValues: collectSensitiveValues(target.compileArgs),
                onStdout: value => { if (value.includes('ready')) { started(); } },
            });
            activeCompile = running;
            const result = await running;
            return {
                schemaVersion: 1, operationId: 'simulated-operation', target,
                status: result.canceled ? 'canceled' : result.exitCode === 0 ? 'success' : 'failed',
                exitCode: result.exitCode, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
                durationMs: result.durationMs, truncated: result.truncated,
            };
        },
    });
    const server = await createAiIpcServer({ sessionDirectory: directory, sketchPath, handler, isTrusted: () => true });
    const child = spawn(process.execPath, [launcher, '--session', server.sessionFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const replies = new Map<number, (value: any) => void>();
    const notifications: any[] = [];
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
        const frame = JSON.parse(line);
        if (typeof frame.id === 'number') { replies.get(frame.id)?.(frame); }
        else { notifications.push(frame); }
    });
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
    const request = (id: number, method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`No bridge response for ${method}; stderr=${stderr}`)), 5000);
        replies.set(id, value => { clearTimeout(timeout); replies.delete(id); resolve(value); });
        send({ jsonrpc: '2.0', id, method, params });
    });
    await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'simulated-client', version: 'test' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return {
        sketchPath, request, send, notifications, startedPromise, input: child.stdin,
        approval: (value: boolean) => { approval = value; }, mode: (value: typeof mode) => { mode = value; },
        compiles: () => compiles,
        compileResult: () => activeCompile,
        waitForExit: async () => {
            let timeout: NodeJS.Timeout | undefined;
            try {
                return await Promise.race([exited, new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Bridge did not exit after terminal shutdown')), 3000);
                })]);
            } finally { clearTimeout(timeout); }
        },
        close: async () => {
            child.stdin.end();
            await exited;
            await activeCompile;
            await server.dispose();
            lines.close();
            await fs.rm(directory, { recursive: true, force: true });
            assert.equal(stderr, '', 'stdio protocol must have no unexpected diagnostics');
        },
    };
}

test('standalone packaged bridge reaches extension operations and reports compile completion/errors', async () => {
    const f = await fixture();
    try {
        const tools = await f.request(2, 'tools/list');
        assert.equal(tools.result.tools.length, 4);
        const context = await f.request(3, 'tools/call', { name: 'get_project_context', arguments: { sketchPath: f.sketchPath } });
        assert.equal(context.result.structuredContent.fqbn, 'arduino:avr:uno');
        const compile = await f.request(4, 'tools/call', { name: 'compile_sketch', arguments: { sketchPath: f.sketchPath }, _meta: { progressToken: 'compile-progress' } });
        assert.equal(compile.result.structuredContent.status, 'success');
        assert.equal(compile.result.structuredContent.exitCode, 0);
        assert.ok(f.notifications.some(frame => frame.method === 'notifications/progress'));
        f.mode('failure');
        const failure = await f.request(5, 'tools/call', { name: 'compile_sketch', arguments: { sketchPath: f.sketchPath } });
        assert.equal(failure.result.isError, true);
        assert.equal(failure.result.structuredContent.exitCode, 2);
        assert.match(failure.result.structuredContent.stderr, /fixture compile failure/);
        f.approval(false);
        const declined = await f.request(6, 'tools/call', { name: 'compile_sketch', arguments: { sketchPath: f.sketchPath } });
        assert.equal(declined.result.structuredContent.error.code, 'CANCELED');
        assert.equal(f.compiles(), 2);
        assert.equal((await f.request(7, 'tools/call', { name: 'upload', arguments: { sketchPath: f.sketchPath } })).error.code, -32602);
    } finally { await f.close(); }
});

test('packaged bridge forwards MCP cancellation to an owning simulated subprocess', async () => {
    const f = await fixture();
    try {
        f.mode('waiting');
        const compile = f.request(2, 'tools/call', { name: 'compile_sketch', arguments: { sketchPath: f.sketchPath } });
        await f.startedPromise;
        f.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
        assert.equal((await compile).error.code, -32800);
    } finally { await f.close(); }
});

test('packaged bridge flushes terminal errors and exits with client stdin still open', async () => {
    const f = await fixture();
    try {
        f.mode('waiting');
        f.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'compile_sketch', arguments: { sketchPath: f.sketchPath } } });
        await f.startedPromise;
        f.input.write('x'.repeat(65537));
        assert.deepEqual(await f.waitForExit(), { code: 0, signal: null });
        assert.equal(f.input.writableEnded, false, 'the bridge must exit before the client ends stdin');
        assert.ok(f.notifications.some(frame => frame.id === null && frame.error?.code === -32600 && frame.error.message === 'Request exceeds the bridge size limit'));
        assert.equal((await f.compileResult())?.canceled, true, 'terminal shutdown must cancel the active compile');
    } finally { await f.close(); }
});
