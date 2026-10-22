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

/** One standalone MCP process serves changing, explicitly connected VS Code windows. */
async function fixture(t: TestContext) {
    const temporaryRoot = await fs.realpath(os.tmpdir());
    const directory = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'amw-global-')));
    let teardown = async () => {};
    t.after(async () => {
        try { await teardown(); }
        finally {
            const resolved = await fs.realpath(directory);
            assert.equal(resolved, directory);
            assert.equal(path.dirname(resolved), temporaryRoot);
            assert.ok(path.basename(resolved).startsWith('amw-global-'));
            await fs.rm(resolved, { recursive: true, force: true });
        }
    });
    const sketches: string[] = [];
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Unopened']) {
        const sketch = path.join(directory, name);
        await fs.mkdir(sketch);
        sketches.push(await fs.realpath(sketch));
    }
    const [alpha, beta, gamma, unopened] = sketches;
    const sessionDirectory = path.join(directory, 'ai-bridge');
    const launcher = path.join(directory, 'standalone-launcher.cjs');
    await fs.copyFile(path.join(process.cwd(), 'build', 'aiBridge.cjs'), launcher);
    const child = spawn(process.execPath, [launcher, '--session-dir', sessionDirectory], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    const servers: AiIpcServer[] = [];
    const replies = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    let stderr = '';
    let nextId = 1;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdin.on('error', () => { /* Pending requests report premature process termination. */ });
    const rejectPending = (error: Error) => {
        for (const reply of replies.values()) { reply.reject(error); }
        replies.clear();
    };
    child.on('error', rejectPending);
    const exited = new Promise<void>(resolve => child.once('close', () => {
        rejectPending(new Error(`Global bridge exited before replying; stderr=${stderr}`));
        resolve();
    }));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
        let frame: any;
        try { frame = JSON.parse(line); }
        catch { rejectPending(new Error('Global bridge emitted non-JSON stdout')); return; }
        if (typeof frame.id === 'number') { replies.get(frame.id)?.resolve(frame); }
    });
    teardown = async () => {
        try {
            child.stdin.end();
            try { await bounded(exited, 'Global bridge did not close after stdin ended', 2000); }
            catch { child.kill(); await bounded(exited, 'Global bridge did not exit during teardown', 2000); }
        } finally {
            lines.close();
            await bounded(Promise.all(servers.map(server => server.dispose())), 'Global session teardown did not finish');
        }
        assert.equal(stderr, '', 'The global launcher must have no unexpected diagnostics');
    };
    const request = async (method: string, params: unknown = {}) => {
        const id = nextId++;
        const reply = new Promise<any>((resolve, reject) => { replies.set(id, { resolve, reject }); });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        try { return await bounded(reply, `No global bridge response for ${method}; stderr=${stderr}`); }
        finally { replies.delete(id); }
    };
    const initialized = await request('initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'global-bridge-test', version: 'test' }
    });
    assert.equal(initialized.error, undefined, JSON.stringify(initialized));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const connect = async (sketchPath: string, label: string, holdCompile = false) => {
        const calls: AiToolName[] = [];
        const started = deferred();
        const aborted = deferred();
        const released = deferred();
        let wasAborted = false;
        const server = await createAiIpcServer({
            sessionDirectory, sketchPath, isTrusted: () => true,
            handler: async (name, input, signal) => {
                calls.push(name);
                if (name === 'compile_sketch' && holdCompile) {
                    const onAbort = () => { wasAborted = true; aborted.resolve(); };
                    if (signal.aborted) { onAbort(); }
                    else { signal.addEventListener('abort', onAbort, { once: true }); }
                    started.resolve();
                    try { await Promise.race([released.promise, aborted.promise]); }
                    finally { signal.removeEventListener('abort', onAbort); }
                }
                return { schemaVersion: 1, status: signal.aborted ? 'canceled' : 'success', session: label, sketchPath: input.sketchPath };
            }
        });
        servers.push(server);
        return {
            server, calls, started: started.promise, aborted: aborted.promise,
            release: released.resolve, wasAborted: () => wasAborted,
            descriptor: JSON.parse(await fs.readFile(server.sessionFile, 'utf8')) as { token: string; endpoint: string; sessionId: string }
        };
    };
    const call = (sketchPath: string, name: AiToolName = 'get_project_context') =>
        request('tools/call', { name, arguments: { sketchPath } });
    const list = () => request('tools/call', { name: 'list_connected_sketches', arguments: {} });
    return { alpha, beta, gamma, unopened, request, call, list, connect };
}

function assertToolError(frame: any, code: string) {
    assert.equal(frame.error, undefined, JSON.stringify(frame));
    assert.equal(frame.result.isError, true, JSON.stringify(frame));
    assert.equal(frame.result.structuredContent.error.code, code);
}

function assertSketches(frame: any, expected: { sketchPath: string; sessionCount: number }[]) {
    assert.equal(frame.error, undefined, JSON.stringify(frame));
    assert.notEqual(frame.result.isError, true, JSON.stringify(frame));
    const result = frame.result.structuredContent;
    const sort = (items: typeof expected) => [...items].sort((left, right) => left.sketchPath.localeCompare(right.sketchPath));
    assert.deepEqual({ ...result, sketches: sort(result.sketches) }, { schemaVersion: 1, sketches: sort(expected) });
}

test('global packaged bridge lists and routes changing connected sketches without restarting', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const tools = await f.request('tools/list');
    assert.deepEqual(tools.result.tools.map((tool: any) => tool.name).sort(),
        ['compile_sketch', 'get_project_context', 'list_boards', 'list_connected_sketches', 'list_dependencies', 'list_ports']);
    assertSketches(await f.list(), []);
    assertSketches(await f.request('tools/call', { name: 'list_connected_sketches' }), []);

    const alpha = await f.connect(f.alpha, 'alpha-window');
    const beta = await f.connect(f.beta, 'beta-window');
    assertSketches(await f.list(), [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal((await f.call(f.alpha)).result.structuredContent.session, 'alpha-window');
    assert.equal((await f.call(f.beta, 'list_ports')).result.structuredContent.session, 'beta-window');
    assert.equal((await f.call(f.beta, 'list_dependencies')).result.structuredContent.session, 'beta-window');
    assert.deepEqual(alpha.calls, ['get_project_context']);
    assert.deepEqual(beta.calls, ['list_ports', 'list_dependencies']);

    // Simulate one window switching folders while a second window stays connected.
    await alpha.server.dispose();
    const gamma = await f.connect(f.gamma, 'switched-window');
    assertSketches(await f.list(), [{ sketchPath: f.beta, sessionCount: 1 }, { sketchPath: f.gamma, sessionCount: 1 }]);
    assertToolError(await f.call(f.alpha), 'SESSION_UNAVAILABLE');
    assert.equal((await f.call(f.gamma)).result.structuredContent.session, 'switched-window');
    await gamma.server.dispose();
    await f.connect(f.alpha, 'reconnected-alpha');
    assert.equal((await f.call(f.alpha)).result.structuredContent.session, 'reconnected-alpha');
    assertSketches(await f.list(), [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
});

test('global discovery and another sketch remain usable during compilation without canceling or replaying it', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const alpha = await f.connect(f.alpha, 'compiling-alpha', true);
    const beta = await f.connect(f.beta, 'beta');
    const compilation = f.call(f.alpha, 'compile_sketch');
    await bounded(alpha.started, 'Compilation never reached alpha');
    const [inspection, listing] = await Promise.all([f.call(f.beta), f.list()]);
    assert.equal(inspection.result.structuredContent.session, 'beta');
    assertSketches(listing, [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal(alpha.wasAborted(), false, 'Inspecting or listing other sessions must retain the active compile connection');
    alpha.release();
    assert.equal((await compilation).result.structuredContent.status, 'success');
    assert.deepEqual(alpha.calls, ['compile_sketch']);
    assert.deepEqual(beta.calls, ['get_project_context']);

    await alpha.server.dispose();
    const interrupted = await f.connect(f.alpha, 'interrupted-alpha', true);
    const pending = f.call(f.alpha, 'compile_sketch');
    await bounded(interrupted.started, 'Second compilation never reached alpha');
    const replacement = await f.connect(f.alpha, 'replacement-alpha');
    await interrupted.server.dispose();
    await bounded(interrupted.aborted, 'Disconnect did not abort compilation');
    assertToolError(await pending, 'SESSION_UNAVAILABLE');
    assert.deepEqual(replacement.calls, [], 'In-flight compilation must not be replayed into the replacement session');
    assert.equal((await f.call(f.alpha)).result.structuredContent.session, 'replacement-alpha');
    assert.deepEqual(replacement.calls, ['get_project_context']);
});

test('global ambiguity is isolated to its sketch and discovery exposes no private descriptors', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const alpha = await f.connect(f.alpha, 'alpha');
    const duplicate = await f.connect(f.alpha, 'duplicate-alpha');
    const beta = await f.connect(f.beta, 'beta');
    const listing = await f.list();
    assertSketches(listing, [{ sketchPath: f.alpha, sessionCount: 2 }, { sketchPath: f.beta, sessionCount: 1 }]);
    for (const { descriptor } of [alpha, duplicate, beta]) {
        for (const value of [descriptor.token, descriptor.endpoint, descriptor.sessionId]) {
            assert.ok(!JSON.stringify(listing).includes(value), 'Discovery must not expose tokens, endpoints, or session identifiers');
        }
    }
    assertToolError(await f.call(f.alpha, 'compile_sketch'), 'AMBIGUOUS_SESSION');
    assertToolError(await f.call(f.unopened, 'compile_sketch'), 'SESSION_UNAVAILABLE');
    assert.deepEqual(alpha.calls, []);
    assert.deepEqual(duplicate.calls, []);
    assert.deepEqual(beta.calls, []);
    assert.equal((await f.call(f.beta)).result.structuredContent.session, 'beta');
    for (const argumentsValue of [{ sketchPath: f.alpha }, { clean: true }, [], null]) {
        const invalid = await f.request('tools/call', { name: 'list_connected_sketches', arguments: argumentsValue });
        assert.equal(invalid.error?.code, -32602, JSON.stringify(invalid));
    }
    const missingPath = await f.request('tools/call', { name: 'compile_sketch', arguments: {} });
    assert.equal(missingPath.error?.code, -32602);
    await duplicate.server.dispose();
    assert.equal((await f.call(f.alpha)).result.structuredContent.session, 'alpha');
    assert.deepEqual(alpha.calls, ['get_project_context']);
});
