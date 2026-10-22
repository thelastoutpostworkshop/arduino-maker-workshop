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

    const connect = async (sketchPath: string, label: string, holdOperation: boolean | AiToolName = false) => {
        const calls: AiToolName[] = [];
        const started = deferred();
        const aborted = deferred();
        const released = deferred();
        let wasAborted = false;
        const server = await createAiIpcServer({
            sessionDirectory, sketchPath, isTrusted: () => true,
            handler: async (name, input, signal) => {
                calls.push(name);
                if (name === (holdOperation === true ? 'compile_sketch' : holdOperation)) {
                    const onAbort = () => { wasAborted = true; aborted.resolve(); };
                    if (signal.aborted) { onAbort(); }
                    else { signal.addEventListener('abort', onAbort, { once: true }); }
                    started.resolve();
                    try { await Promise.race([released.promise, aborted.promise]); }
                    finally { signal.removeEventListener('abort', onAbort); }
                }
                return { schemaVersion: 1, status: signal.aborted ? 'canceled' : 'success', session: label, sketchPath: input.sketchPath, input };
            }
        });
        servers.push(server);
        return {
            server, calls, started: started.promise, aborted: aborted.promise,
            release: released.resolve, wasAborted: () => wasAborted,
            descriptor: JSON.parse(await fs.readFile(server.sessionFile, 'utf8')) as { token: string; endpoint: string; sessionId: string }
        };
    };
    const call = (sketchPath: string, name: AiToolName = 'get_project_context', args: Record<string, unknown> = {}) =>
        request('tools/call', { name, arguments: { sketchPath, ...args } });
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
        ['capture_serial_output', 'compile_sketch', 'decode_esp32_backtrace', 'get_board_details', 'get_project_context', 'install_library', 'list_boards', 'list_connected_sketches', 'list_dependencies', 'list_examples', 'list_ports', 'search_libraries']);
    assertSketches(await f.list(), []);
    assertSketches(await f.request('tools/call', { name: 'list_connected_sketches' }), []);

    const alpha = await f.connect(f.alpha, 'alpha-window');
    const beta = await f.connect(f.beta, 'beta-window');
    assertSketches(await f.list(), [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal((await f.call(f.alpha)).result.structuredContent.session, 'alpha-window');
    assert.equal((await f.call(f.beta, 'list_ports')).result.structuredContent.session, 'beta-window');
    assert.equal((await f.call(f.beta, 'list_dependencies')).result.structuredContent.session, 'beta-window');
    assert.equal((await f.call(f.alpha, 'get_board_details', { profile: 'release' })).result.structuredContent.session, 'alpha-window');
    assert.equal((await f.call(f.beta, 'search_libraries', { query: 'temperature sensor', limit: 10 })).result.structuredContent.session, 'beta-window');
    assert.equal((await f.call(f.beta, 'list_examples', { source: 'board' })).result.structuredContent.session, 'beta-window');
    const decodeInput = { profile: 'release', log: 'Backtrace: 0x40012345:0x3ffb0020' };
    const decoded = (await f.call(f.beta, 'decode_esp32_backtrace', decodeInput)).result.structuredContent;
    assert.equal(decoded.session, 'beta-window');
    assert.deepEqual(decoded.input, { sketchPath: f.beta, ...decodeInput });
    const installInput = { library: 'Adafruit NeoPixel', version: '1.12.0' };
    const installed = (await f.call(f.beta, 'install_library', installInput)).result.structuredContent;
    assert.equal(installed.session, 'beta-window');
    assert.deepEqual(installed.input, { sketchPath: f.beta, ...installInput });
    const captureInput = { port: 'COM5', baudRate: 115200, durationMs: 10000, maxOutputBytes: 8192 };
    const captured = (await f.call(f.beta, 'capture_serial_output', captureInput)).result.structuredContent;
    assert.equal(captured.session, 'beta-window');
    assert.deepEqual(captured.input, { sketchPath: f.beta, ...captureInput });
    assert.deepEqual(alpha.calls, ['get_project_context', 'get_board_details']);
    assert.deepEqual(beta.calls, ['list_ports', 'list_dependencies', 'search_libraries', 'list_examples', 'decode_esp32_backtrace', 'install_library', 'capture_serial_output']);

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
    const [inspection, listing] = await Promise.all([f.call(f.beta, 'search_libraries', { query: 'sensor' }), f.list()]);
    assert.equal(inspection.result.structuredContent.session, 'beta');
    assertSketches(listing, [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal(alpha.wasAborted(), false, 'Inspecting or listing other sessions must retain the active compile connection');
    alpha.release();
    assert.equal((await compilation).result.structuredContent.status, 'success');
    assert.deepEqual(alpha.calls, ['compile_sketch']);
    assert.deepEqual(beta.calls, ['search_libraries']);

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
    assertToolError(await f.call(f.alpha, 'decode_esp32_backtrace', { log: 'Backtrace: 0x40012345' }), 'AMBIGUOUS_SESSION');
    assertToolError(await f.call(f.alpha, 'install_library', { library: 'Adafruit NeoPixel', version: '1.12.0' }), 'AMBIGUOUS_SESSION');
    assertToolError(await f.call(f.unopened, 'compile_sketch'), 'SESSION_UNAVAILABLE');
    assertToolError(await f.call(f.unopened, 'decode_esp32_backtrace', { log: 'Backtrace: 0x40012345' }), 'SESSION_UNAVAILABLE');
    assertToolError(await f.call(f.unopened, 'install_library', { library: 'Adafruit NeoPixel', version: '1.12.0' }), 'SESSION_UNAVAILABLE');
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

test('global packaged decoding keeps other sketches available and never replays an interrupted decode', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const alpha = await f.connect(f.alpha, 'decoding-alpha', 'decode_esp32_backtrace');
    const beta = await f.connect(f.beta, 'beta');
    const pending = f.call(f.alpha, 'decode_esp32_backtrace', { profile: 'debug', log: 'Backtrace: 0x40012345:0x3ffb0020' });
    await bounded(alpha.started, 'Decoding never reached its selected window');
    const [otherSketch, listing] = await Promise.all([f.call(f.beta), f.list()]);
    assert.equal(otherSketch.result.structuredContent.session, 'beta');
    assertSketches(listing, [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal(alpha.wasAborted(), false, 'Other sketch operations must retain the decoder connection');
    const replacement = await f.connect(f.alpha, 'replacement-alpha');
    await alpha.server.dispose();
    await bounded(alpha.aborted, 'Disconnect did not abort decoding');
    assertToolError(await pending, 'SESSION_UNAVAILABLE');
    assert.deepEqual(replacement.calls, [], 'An interrupted decode must not replay into another session');
    assert.equal((await f.call(f.alpha, 'decode_esp32_backtrace', { log: 'Backtrace: 0x40012345' })).result.structuredContent.session, 'replacement-alpha');
    assert.deepEqual(alpha.calls, ['decode_esp32_backtrace']);
    assert.deepEqual(replacement.calls, ['decode_esp32_backtrace']);
    assert.deepEqual(beta.calls, ['get_project_context']);
});

test('global packaged installation stays on its sketch and never replays after session loss', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const alpha = await f.connect(f.alpha, 'installing-alpha', 'install_library');
    const beta = await f.connect(f.beta, 'beta');
    const args = { profile: 'release', library: 'Adafruit NeoPixel', version: '1.12.0' };
    const pending = f.call(f.alpha, 'install_library', args);
    await bounded(alpha.started, 'Installation never reached its selected window');
    const [otherSketch, listing] = await Promise.all([f.call(f.beta), f.list()]);
    assert.equal(otherSketch.result.structuredContent.session, 'beta');
    assertSketches(listing, [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal(alpha.wasAborted(), false);
    const replacement = await f.connect(f.alpha, 'replacement-alpha');
    await alpha.server.dispose();
    await bounded(alpha.aborted, 'Disconnect did not abort installation');
    assertToolError(await pending, 'SESSION_UNAVAILABLE');
    assert.deepEqual(replacement.calls, [], 'An interrupted library mutation must not replay into another session');
    const retried = await f.call(f.alpha, 'install_library', args);
    assert.equal(retried.result.structuredContent.session, 'replacement-alpha');
    assert.deepEqual(retried.result.structuredContent.input, { sketchPath: f.alpha, ...args });
    assert.deepEqual(alpha.calls, ['install_library']);
    assert.deepEqual(replacement.calls, ['install_library']);
    assert.deepEqual(beta.calls, ['get_project_context']);
});

test('global packaged capture aborts with its session and does not reopen the port in another session', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const alpha = await f.connect(f.alpha, 'capturing-alpha', 'capture_serial_output');
    const beta = await f.connect(f.beta, 'beta');
    const args = { port: 'COM5', baudRate: 115200, durationMs: 10000, maxOutputBytes: 8192 };
    const pending = f.call(f.alpha, 'capture_serial_output', args);
    await bounded(alpha.started, 'Capture never reached its selected window');
    const [otherSketch, listing] = await Promise.all([f.call(f.beta), f.list()]);
    assert.equal(otherSketch.result.structuredContent.session, 'beta');
    assertSketches(listing, [{ sketchPath: f.alpha, sessionCount: 1 }, { sketchPath: f.beta, sessionCount: 1 }]);
    assert.equal(alpha.wasAborted(), false);
    const replacement = await f.connect(f.alpha, 'replacement-alpha');
    await alpha.server.dispose();
    await bounded(alpha.aborted, 'Session loss did not abort capture');
    assertToolError(await pending, 'SESSION_UNAVAILABLE');
    assert.deepEqual(replacement.calls, [], 'An interrupted capture must not reopen a port in another session');
    const retried = await f.call(f.alpha, 'capture_serial_output', args);
    assert.equal(retried.result.structuredContent.session, 'replacement-alpha');
    assert.deepEqual(retried.result.structuredContent.input, { sketchPath: f.alpha, ...args });
    assert.deepEqual(alpha.calls, ['capture_serial_output']);
    assert.deepEqual(replacement.calls, ['capture_serial_output']);
    assert.deepEqual(beta.calls, ['get_project_context']);
});
