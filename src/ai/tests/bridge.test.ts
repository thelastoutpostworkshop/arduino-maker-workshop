import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { test, TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { AiBridgeError, AiToolHandler, AiToolName } from '../contracts';
import { AiIpcClient, AiIpcServer, createAiIpcServer, readSessionDescriptor, receiveLines } from '../ipcServer';
import { getMcpTools, runMcpBridge } from '../mcpBridge';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function captureServer(context: TestContext): () => net.Server {
    const netModule = require('node:net') as typeof net;
    const original = netModule.createServer;
    let captured: net.Server | undefined;
    context.mock.method(netModule, 'createServer', ((...args: unknown[]) => {
        captured = Reflect.apply(original, netModule, args) as net.Server;
        return captured;
    }) as typeof net.createServer);
    return () => { assert.ok(captured); return captured; };
}

async function fixture(handler: AiToolHandler, trusted: () => boolean = () => true) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-bridge-test-'));
    const sketchPath = path.join(root, 'Blink');
    await fs.mkdir(sketchPath);
    let server: AiIpcServer;
    try { server = await createAiIpcServer({ sessionDirectory: path.join(root, 'sessions'), sketchPath, handler, isTrusted: trusted }); }
    catch (error) { await fs.rm(root, { recursive: true, force: true }); throw error; }
    return { root, sketchPath: await fs.realpath(sketchPath), server, async dispose() { await server.dispose(); await fs.rm(root, { recursive: true, force: true }); } };
}

async function rawFrame(endpoint: string, frame: unknown): Promise<Record<string, unknown>> {
    const socket = net.createConnection(endpoint);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('IPC test timeout')); }, 2000);
        socket.once('error', reject);
        receiveLines(socket, 65536, line => {
            clearTimeout(timer);
            socket.destroy();
            resolve(JSON.parse(line));
        }, () => reject(new Error('Oversized IPC frame')));
        socket.once('connect', () => socket.write(JSON.stringify(frame) + '\n'));
    });
}

function harness(sessionFile: string) {
    const input = new PassThrough();
    const output = new PassThrough();
    const events = new EventEmitter();
    const messages: Record<string, any>[] = [];
    receiveLines(output, 6 * 1024 * 1024, line => {
        const message = JSON.parse(line);
        messages.push(message);
        events.emit('message', message);
    }, () => { throw new Error('Oversized MCP response'); });
    const running = runMcpBridge(input, output, sessionFile);
    const send = (value: unknown) => input.write(JSON.stringify(value) + '\n');
    const waitFor = (predicate: (value: Record<string, any>) => boolean): Promise<Record<string, any>> => {
        const existing = messages.find(predicate);
        if (existing) { return Promise.resolve(existing); }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { events.removeListener('message', listener); reject(new Error('MCP test timeout')); }, 3000);
            const listener = (message: Record<string, any>) => {
                if (predicate(message)) { clearTimeout(timer); events.removeListener('message', listener); resolve(message); }
            };
            events.on('message', listener);
        });
    };
    return {
        input, output, messages, send, waitFor,
        async initialize(version = '2025-06-18') {
            send({ jsonrpc: '2.0', id: 'initialize', method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } });
            const initialized = await waitFor(message => message.id === 'initialize');
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            return initialized;
        },
        async dispose() { input.end(); await running; output.destroy(); }
    };
}

test('IPC authenticates a private ephemeral session and returns structured results', async () => {
    const context = await fixture(async (name, input) => ({ schemaVersion: 1, name, input }));
    let client: AiIpcClient | undefined;
    try {
        const descriptor = await readSessionDescriptor(context.server.sessionFile);
        assert.equal(descriptor.sessionId, context.server.sessionId);
        assert.equal(descriptor.token.length, 64);
        if (process.platform !== 'win32') {
            assert.equal((await fs.stat(context.server.sessionFile)).mode & 0o077, 0);
            assert.equal((await fs.stat(path.dirname(context.server.sessionFile))).mode & 0o077, 0);
            assert.equal((await fs.stat(path.dirname(descriptor.endpoint))).mode & 0o077, 0);
            assert.ok(Buffer.byteLength(descriptor.endpoint) <= 100);
        }
        client = await AiIpcClient.connect(context.server.sessionFile);
        const result = await client.call('get_project_context', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}) as Record<string, unknown>;
        assert.equal(result.name, 'get_project_context');
        await context.server.dispose();
        await assert.rejects(fs.stat(context.server.sessionFile), { code: 'ENOENT' });
        if (process.platform !== 'win32') { await assert.rejects(fs.stat(path.dirname(descriptor.endpoint)), { code: 'ENOENT' }); }
    } finally { client?.dispose(); await context.dispose(); }
});

test('IPC rejects bad credentials, session identity, foreign sketch, disallowed tools and lost trust before handling', async () => {
    let calls = 0;
    let trusted = true;
    const context = await fixture(async () => { calls++; return {}; }, () => trusted);
    let client: AiIpcClient | undefined;
    try {
        const descriptor = await readSessionDescriptor(context.server.sessionFile);
        for (const override of [{ token: '0'.repeat(64) }, { sessionId: 'another-window' }, { workspaceId: 'another-workspace' }, { sketchPath: path.dirname(context.sketchPath) }]) {
            const response = await rawFrame(descriptor.endpoint, { type: 'hello', ...descriptor, ...override });
            assert.equal((response.error as Record<string, unknown>).code, 'UNAUTHORIZED');
            assert.equal(JSON.stringify(response).includes(descriptor.token), false);
        }
        client = await AiIpcClient.connect(context.server.sessionFile);
        await assert.rejects(client.call('get_project_context', { sketchPath: context.root }, new AbortController().signal, () => {}), { code: 'WRONG_WORKSPACE' });
        await assert.rejects(client.call('upload_sketch' as AiToolName, { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'UNKNOWN_TOOL' });
        trusted = false;
        await assert.rejects(client.call('compile_sketch', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'WORKSPACE_UNTRUSTED' });
        assert.equal(calls, 0);
    } finally { client?.dispose(); await context.dispose(); }
});

test('IPC cancellation, client disconnect and session stop abort the corresponding request', async () => {
    for (const mode of ['cancel', 'disconnect', 'stop']) {
        const started = deferred<void>();
        const aborted = deferred<void>();
        const context = await fixture(async (_name, _input, signal) => {
            started.resolve();
            await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { aborted.resolve(); reject(new AiBridgeError('CANCELED', 'Canceled')); }, { once: true }));
        });
        const client = await AiIpcClient.connect(context.server.sessionFile);
        try {
            const controller = new AbortController();
            const pending = client.call('compile_sketch', { sketchPath: context.sketchPath }, controller.signal, () => {});
            const checked = assert.rejects(pending, { code: mode === 'cancel' ? 'CANCELED' : 'SESSION_UNAVAILABLE' });
            await started.promise;
            if (mode === 'cancel') { controller.abort(); }
            else if (mode === 'disconnect') { client.dispose(); }
            else { await context.server.dispose(); }
            await checked;
            await aborted.promise;
        } finally { client.dispose(); await context.dispose(); }
    }
});

test('IPC masks unexpected internal errors and limits results', async () => {
    let large = false;
    const context = await fixture(async () => { if (large) { return { output: 'x'.repeat(3 * 1024 * 1024) }; } throw new Error('private-secret-value'); });
    const client = await AiIpcClient.connect(context.server.sessionFile);
    try {
        await assert.rejects(client.call('get_project_context', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), error => {
            assert.equal((error as AiBridgeError).code, 'INTERNAL_ERROR');
            assert.equal(String(error).includes('private-secret-value'), false);
            return true;
        });
        large = true;
        await assert.rejects(client.call('get_project_context', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'OUTPUT_LIMIT' });
    } finally { client.dispose(); await context.dispose(); }
});

test('descriptor validation refuses endpoint substitution without revealing its contents', async () => {
    const context = await fixture(async () => ({}));
    try {
        const descriptor = await readSessionDescriptor(context.server.sessionFile);
        await fs.writeFile(context.server.sessionFile, JSON.stringify({ ...descriptor, endpoint: 'private-substituted-endpoint' }));
        await assert.rejects(readSessionDescriptor(context.server.sessionFile), error => {
            assert.equal((error as AiBridgeError).code, 'INVALID_SESSION');
            assert.equal(String(error).includes(descriptor.token), false);
            assert.equal(String(error).includes('private-substituted-endpoint'), false);
            return true;
        });
    } finally { await context.dispose(); }
});

test('MCP negotiates supported versions and offers exactly four explicit scoped tools', async () => {
    const context = await fixture(async () => ({}));
    try {
        for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', 'unsupported-version']) {
            const bridge = harness(context.server.sessionFile);
            try {
                const response = await bridge.initialize(version);
                assert.equal(response.result.protocolVersion, version === 'unsupported-version' ? '2025-06-18' : version);
                assert.ok(response.result.instructions.includes(`Connected sketch: ${context.sketchPath}`));
                bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
                const listed = await bridge.waitFor(message => message.id === 1);
                assert.deepEqual(listed.result.tools.map((tool: Record<string, unknown>) => tool.name), ['get_project_context', 'list_boards', 'list_ports', 'compile_sketch']);
                for (const tool of listed.result.tools) {
                    assert.deepEqual(tool.inputSchema.required, ['sketchPath']);
                    assert.equal(tool.inputSchema.additionalProperties, false);
                    assert.equal(tool.annotations.readOnlyHint, tool.name !== 'compile_sketch');
                    assert.equal('clean' in tool.inputSchema.properties, tool.name === 'compile_sketch');
                }
            } finally { await bridge.dispose(); }
        }
        assert.equal(getMcpTools().length, 4);
    } finally { await context.dispose(); }
});

test('MCP validates initialization, malformed input, unknown methods and tool schemas', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = harness(context.server.sessionFile);
    try {
        bridge.input.write('{malformed\n');
        assert.equal((await bridge.waitFor(message => message.error?.code === -32700)).id, null);
        bridge.send([]);
        await bridge.waitFor(message => message.error?.code === -32600);
        bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        assert.equal((await bridge.waitFor(message => message.id === 1)).error.code, -32002);
        await bridge.initialize();
        bridge.send({ jsonrpc: '2.0', id: 2, method: 'arbitrary/execute' });
        assert.equal((await bridge.waitFor(message => message.id === 2)).error.code, -32601);
        for (const [id, name, args] of [[3, 'upload_sketch', { sketchPath: context.sketchPath }], [4, 'compile_sketch', {}], [5, 'list_ports', { sketchPath: context.sketchPath, clean: true }], [6, 'compile_sketch', { sketchPath: context.sketchPath, executable: 'shell' }]] as const) {
            bridge.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
            assert.equal((await bridge.waitFor(message => message.id === id)).error.code, -32602);
        }
        assert.equal(calls, 0);
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('MCP returns structured and text results with progress and operation failures', async () => {
    let failed = false;
    const context = await fixture(async (_name, input, _signal, progress) => {
        progress({ message: 'Inspecting selected profile' });
        if (failed) { throw new AiBridgeError('MISSING_CORE', 'Install the selected board package in VS Code.'); }
        return { schemaVersion: 1, sketchPath: input.sketchPath, status: 'success' };
    });
    const bridge = harness(context.server.sessionFile);
    try {
        await bridge.initialize();
        bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compile_sketch', arguments: { sketchPath: context.sketchPath, clean: false }, _meta: { progressToken: 'build-progress' } } });
        const response = await bridge.waitFor(message => message.id === 1);
        assert.equal(response.result.isError, false);
        assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
        assert.equal((await bridge.waitFor(message => message.method === 'notifications/progress')).params.progressToken, 'build-progress');
        assert.equal(JSON.stringify(bridge.messages).includes((await readSessionDescriptor(context.server.sessionFile)).token), false);
        failed = true;
        bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'compile_sketch', arguments: { sketchPath: context.sketchPath } } });
        const failure = await bridge.waitFor(message => message.id === 2);
        assert.equal(failure.result.isError, true);
        assert.equal(failure.result.structuredContent.error.code, 'MISSING_CORE');
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('MCP rejects duplicate active IDs, forwards cancellation and aborts work on stdin close', async () => {
    for (const mode of ['cancel', 'stdin-close']) {
        const started = deferred<void>();
        const aborted = deferred<void>();
        const context = await fixture(async (_name, _input, signal) => {
            started.resolve();
            await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { aborted.resolve(); reject(new AiBridgeError('CANCELED', 'Canceled')); }, { once: true }));
        });
        const bridge = harness(context.server.sessionFile);
        try {
            await bridge.initialize();
            const request = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'compile_sketch', arguments: { sketchPath: context.sketchPath } } };
            bridge.send(request);
            await started.promise;
            if (mode === 'cancel') {
                bridge.send(request);
                await bridge.waitFor(message => message.id === 7 && message.error?.code === -32600);
                bridge.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, reason: 'Canceled by test' } });
                await bridge.waitFor(message => message.id === 7 && message.error?.code === -32800);
            } else { await bridge.dispose(); }
            await aborted.promise;
        } finally { await bridge.dispose(); await context.dispose(); }
    }
});

test('MCP bounds oversized input and never executes truncated frames', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = harness(context.server.sessionFile);
    try {
        await bridge.initialize();
        bridge.input.write('x'.repeat(65537));
        await bridge.waitFor(message => message.error?.message === 'Request exceeds the bridge size limit');
        assert.equal(calls, 0);
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('MCP stdin ending with a partial tool frame never starts that operation', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = harness(context.server.sessionFile);
    try {
        await bridge.initialize();
        bridge.input.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'compile_sketch', arguments: { sketchPath: context.sketchPath } } }));
        await bridge.dispose();
        assert.equal(calls, 0);
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('IPC bounds active operations across multiple authenticated clients', async () => {
    let calls = 0;
    const full = deferred<void>();
    const context = await fixture(async (_name, _input, signal) => {
        calls++;
        if (calls === 16) { full.resolve(); }
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new AiBridgeError('CANCELED', 'Canceled')), { once: true }));
    });
    const first = await AiIpcClient.connect(context.server.sessionFile);
    const second = await AiIpcClient.connect(context.server.sessionFile);
    const controllers: AbortController[] = [];
    const pending: Promise<void>[] = [];
    try {
        for (let index = 0; index < 16; index++) {
            const controller = new AbortController();
            controllers.push(controller);
            const client = index % 2 ? first : second;
            pending.push(assert.rejects(client.call('get_project_context', { sketchPath: context.sketchPath }, controller.signal, () => {}), { code: 'CANCELED' }));
        }
        await full.promise;
        await assert.rejects(second.call('get_project_context', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'BUSY' });
        assert.equal(calls, 16);
        for (const controller of controllers) { controller.abort(); }
        await Promise.all(pending);
    } finally {
        for (const controller of controllers) { controller.abort(); }
        first.dispose(); second.dispose(); await context.dispose();
    }
});

test('IPC runtime server errors revoke the session, abort work and clean up without escaping', async testContext => {
    const serverInstance = captureServer(testContext);
    const started = deferred<void>();
    const aborted = deferred<void>();
    const context = await fixture(async (_name, _input, signal) => {
        started.resolve();
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
            aborted.resolve();
            reject(new AiBridgeError('CANCELED', 'Canceled'));
        }, { once: true }));
    });
    const client = await AiIpcClient.connect(context.server.sessionFile);
    try {
        const descriptor = await readSessionDescriptor(context.server.sessionFile);
        const pending = assert.rejects(client.call('compile_sketch', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'SESSION_UNAVAILABLE' });
        await started.promise;
        assert.ok(serverInstance().listenerCount('error') >= 1);
        assert.doesNotThrow(() => serverInstance().emit('error', new Error(`Transport failure ${descriptor.token}`)));
        await pending;
        await aborted.promise;
        // Verify automatic cleanup before calling the public, idempotent dispose method.
        for (let attempt = 0; attempt < 200; attempt++) {
            if (!(await fs.stat(context.server.sessionFile).catch(() => undefined))) { break; }
            await delay(5);
        }
        await assert.rejects(fs.stat(context.server.sessionFile), { code: 'ENOENT' });
        assert.equal(serverInstance().listening, false);
        if (process.platform !== 'win32') { await assert.rejects(fs.stat(path.dirname(descriptor.endpoint)), { code: 'ENOENT' }); }
        await context.server.dispose();
        assert.doesNotThrow(() => serverInstance().emit('error', new Error('A later transport error')));
    } finally { client.dispose(); await context.dispose(); }
});

test('IPC failed descriptor publication cleans its session and private socket directories', async testContext => {
    const serverInstance = captureServer(testContext);
    const fsModule = require('node:fs/promises') as typeof fs;
    testContext.mock.method(fsModule, 'writeFile', async () => { throw new Error('Descriptor publication failed'); });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-bridge-failed-test-'));
    const sketchPath = path.join(root, 'Blink');
    const sessionDirectory = path.join(root, 'sessions');
    await fs.mkdir(sketchPath);
    let endpoint: string | undefined;
    const originalListen = net.Server.prototype.listen;
    testContext.mock.method(net.Server.prototype, 'listen', (function(this: net.Server, ...args: unknown[]) {
        this.once('listening', () => { const address = this.address(); if (typeof address === 'string') { endpoint = address; } });
        return Reflect.apply(originalListen, this, args);
    }) as typeof originalListen);
    try {
        await assert.rejects(createAiIpcServer({ sessionDirectory, sketchPath, handler: async () => ({}), isTrusted: () => true }), /Descriptor publication failed/);
        assert.deepEqual(await fs.readdir(sessionDirectory), []);
        assert.equal(serverInstance().listening, false);
        if (process.platform !== 'win32') { assert.ok(endpoint); await assert.rejects(fs.stat(path.dirname(endpoint)), { code: 'ENOENT' }); }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
