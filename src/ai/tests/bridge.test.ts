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
import { getMcpTools, main, runMcpBridge } from '../mcpBridge';
import { AiSessionResolver } from '../sessionDiscovery';

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
    const sessionDirectory = path.join(root, 'sessions');
    let server: AiIpcServer;
    try { server = await createAiIpcServer({ sessionDirectory, sketchPath, handler, isTrusted: trusted }); }
    catch (error) { await fs.rm(root, { recursive: true, force: true }); throw error; }
    return { root, sessionDirectory, sketchPath: await fs.realpath(sketchPath), server, async dispose() { await server.dispose(); await fs.rm(root, { recursive: true, force: true }); } };
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

async function harness(sessionDirectory: string) {
    const resolver = await AiSessionResolver.createGlobal(sessionDirectory);
    const input = new PassThrough();
    const output = new PassThrough();
    const events = new EventEmitter();
    const messages: Record<string, any>[] = [];
    receiveLines(output, 6 * 1024 * 1024, line => {
        const message = JSON.parse(line);
        messages.push(message);
        events.emit('message', message);
    }, () => { throw new Error('Oversized MCP response'); });
    const running = runMcpBridge(input, output, resolver);
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
        await assert.rejects(client.call('list_dependencies', { sketchPath: context.root }, new AbortController().signal, () => {}), { code: 'WRONG_WORKSPACE' });
        await assert.rejects(client.call('list_dependencies', { sketchPath: context.sketchPath, clean: true }, new AbortController().signal, () => {}), { code: 'INVALID_ARGUMENTS' });
        await assert.rejects(client.call('upload_sketch' as AiToolName, { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'UNKNOWN_TOOL' });
        trusted = false;
        await assert.rejects(client.call('compile_sketch', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'WORKSPACE_UNTRUSTED' });
        await assert.rejects(client.call('list_dependencies', { sketchPath: context.sketchPath }, new AbortController().signal, () => {}), { code: 'WORKSPACE_UNTRUSTED' });
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

test('MCP negotiates supported versions and offers discovery plus ten explicitly targeted tools', async () => {
    const context = await fixture(async () => ({}));
    try {
        for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', 'unsupported-version']) {
            const bridge = await harness(context.sessionDirectory);
            try {
                const response = await bridge.initialize(version);
                assert.equal(response.result.protocolVersion, version === 'unsupported-version' ? '2025-06-18' : version);
                assert.ok(response.result.instructions.includes('Call list_connected_sketches first'));
                assert.equal(response.result.instructions.includes(context.sketchPath), false);
                bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
                const listed = await bridge.waitFor(message => message.id === 1);
                assert.deepEqual(listed.result.tools.map((tool: Record<string, unknown>) => tool.name).sort(), [
                    'compile_sketch', 'decode_esp32_backtrace', 'get_board_details', 'get_project_context', 'install_library', 'list_boards',
                    'list_connected_sketches', 'list_dependencies', 'list_examples', 'list_ports', 'search_libraries'
                ]);
                for (const tool of listed.result.tools) {
                    assert.deepEqual(tool.inputSchema.required, tool.name === 'list_connected_sketches' ? undefined
                        : tool.name === 'search_libraries' ? ['sketchPath', 'query']
                        : tool.name === 'install_library' ? ['sketchPath', 'library', 'version']
                        : tool.name === 'decode_esp32_backtrace' ? ['sketchPath', 'log'] : ['sketchPath']);
                    assert.equal(tool.inputSchema.additionalProperties, false);
                    const initializesCli = ['compile_sketch', 'list_dependencies', 'get_board_details', 'search_libraries', 'list_examples', 'install_library'].includes(tool.name);
                    assert.equal(tool.annotations.readOnlyHint, !initializesCli);
                    assert.equal(tool.annotations.idempotentHint, !initializesCli);
                    assert.equal(tool.annotations.openWorldHint, initializesCli);
                    assert.equal(tool.annotations.destructiveHint, ['compile_sketch', 'install_library'].includes(tool.name));
                    assert.equal('clean' in tool.inputSchema.properties, tool.name === 'compile_sketch');
                }
            } finally { await bridge.dispose(); }
        }
        assert.equal(getMcpTools().length, 11);
    } finally { await context.dispose(); }
});

test('MCP exposes only an exact indexed library and version for shared-library installation', () => {
    const tool = (getMcpTools() as Record<string, any>[]).find(value => value.name === 'install_library');
    assert.ok(tool);
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['library', 'profile', 'sketchPath', 'version']);
    assert.deepEqual(tool.inputSchema.required, ['sketchPath', 'library', 'version']);
    assert.equal(tool.inputSchema.properties.library.maxLength, 256);
    assert.equal(tool.inputSchema.properties.version.maxLength, 64);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.annotations, {
        title: 'Install Arduino Library', readOnlyHint: false, destructiveHint: true,
        idempotentHint: false, openWorldHint: true,
    });
    assert.match(tool.description, /shared user libraries/);
    assert.match(tool.description, /version must match any pin/);
    assert.match(tool.description, /Does not edit sketch.yaml or populate isolated profile caches/);
});

test('MCP and authenticated IPC reject malformed or injectable library installation inputs', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = await harness(context.sessionDirectory);
    const client = await AiIpcClient.connect(context.server.sessionFile);
    try {
        await bridge.initialize();
        const valid = { sketchPath: context.sketchPath, library: 'Adafruit NeoPixel', version: '1.12.0' };
        const cases: { name: AiToolName; args: Record<string, unknown> }[] = [];
        for (const library of [undefined, null, 42, [], '', ' ', 'x'.repeat(257), '--git-url', '-Library',
            '../Library', 'C:\\libraries\\Library', '/tmp/Library', 'https://example.com/library.zip',
            'git@example.com:Library', 'Library@1.2.3', 'Library;command', 'Library & command',
            'Library$(command)', 'Library`command`', 'Library\nOther', 'Library\x00', 'Library\x7f',
            'Library,Other', 'Library=Other']) {
            cases.push({ name: 'install_library', args: { ...valid, library } });
        }
        for (const version of [undefined, null, 42, [], '', ' ', 'latest', '*', '^1.2.3', '~1.2.3',
            '>=1.2.3', '1', '1.2', 'v1.2.3', '01.2.3', '1.02.3', '1.2.03', '1.2.3-01', '1.2.3-',
            '1.2.3+', '1.2.3-a..b', '1.2.3+build..hash', ' 1.2.3', '1.2.3 ', '1.2.3\n',
            '1.2.3\x00', '--no-deps', '1.2.3@Other', 'https://example.com/1.2.3',
            '1.2.3;command', '1.2.3+build' + 'x'.repeat(60)]) {
            cases.push({ name: 'install_library', args: { ...valid, version } });
        }
        for (const override of [{ sketchPath: undefined }, { sketchPath: 'relative' }, { profile: '../profile' },
            { profile: '' }, { profile: 42 }, { command: 'install' }, { args: ['--no-deps'] },
            { executable: 'shell' }, { path: context.root }, { url: 'https://example.com/library.zip' },
            { zip: 'library.zip' }, { git: 'https://example.com/repo' }, { noDependencies: true },
            { clean: true }, { query: 'sensor' }, { source: 'libraries' }, { limit: 1 }, { log: 'crash' }]) {
            cases.push({ name: 'install_library', args: { ...valid, ...override } });
        }
        for (const name of ['get_project_context', 'compile_sketch', 'search_libraries', 'list_examples', 'decode_esp32_backtrace'] as const) {
            cases.push({ name, args: { sketchPath: context.sketchPath, version: '1.12.0',
                ...(name === 'search_libraries' ? { query: 'sensor' } : {}),
                ...(name === 'list_examples' ? { library: 'Adafruit NeoPixel' } : {}),
                ...(name === 'decode_esp32_backtrace' ? { log: 'crash' } : {}),
            } });
        }
        let id = 1;
        for (const { name, args } of cases) {
            const requestId = id++;
            bridge.send({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } });
            assert.equal((await bridge.waitFor(message => message.id === requestId)).error?.code, -32602, JSON.stringify(args));
            await assert.rejects(client.call(name, args as unknown as Parameters<AiIpcClient['call']>[1],
                new AbortController().signal, () => {}), { code: 'INVALID_ARGUMENTS' });
        }
        assert.equal(calls, 0, 'Invalid installation arguments must never reach the extension');
    } finally { client.dispose(); await bridge.dispose(); await context.dispose(); }
});

test('MCP routes exact library names, versions and profiles with structured results and progress', async () => {
    const received: unknown[] = [];
    const context = await fixture(async (name, input, _signal, progress) => {
        assert.equal(name, 'install_library');
        received.push(input);
        progress({ message: 'Installing indexed library' });
        return { schemaVersion: 1, status: 'success', library: input.library, version: input.version, scope: 'user_libraries' };
    });
    const bridge = await harness(context.sessionDirectory);
    try {
        await bridge.initialize();
        const cases = [
            { library: '  Adafruit NeoPixel  ', version: '1.12.0', profile: 'release' },
            { library: 'Library_Name-1.2', version: '0.1.0-rc.1+build.5' },
            { library: 'L'.repeat(256), version: '1.2.3+' + 'a'.repeat(58) },
        ];
        for (let id = 0; id < cases.length; id++) {
            const args = { sketchPath: context.sketchPath, ...cases[id] };
            bridge.send({ jsonrpc: '2.0', id, method: 'tools/call', params: {
                name: 'install_library', arguments: args, _meta: { progressToken: `install-${id}` },
            } });
            const response = await bridge.waitFor(message => message.id === id);
            assert.equal(response.error, undefined);
            assert.equal(response.result.isError, false);
            assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
            assert.equal(response.result.structuredContent.version, args.version);
            assert.deepEqual(received[id], { ...args, library: args.library.trim() });
            assert.ok(bridge.messages.some(message => message.method === 'notifications/progress' && message.params.progressToken === `install-${id}`));
        }
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('library installation retains workspace, trust and MCP cancellation guards', async () => {
    let calls = 0;
    let trusted = true;
    const started = deferred<void>();
    const aborted = deferred<void>();
    const context = await fixture(async (_name, _input, signal) => {
        calls++;
        started.resolve();
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
            aborted.resolve(); reject(new AiBridgeError('CANCELED', 'Canceled'));
        }, { once: true }));
    }, () => trusted);
    const client = await AiIpcClient.connect(context.server.sessionFile);
    const bridge = await harness(context.sessionDirectory);
    try {
        const args = { sketchPath: context.sketchPath, library: 'Adafruit NeoPixel', version: '1.12.0' };
        await assert.rejects(client.call('install_library', { ...args, sketchPath: context.root },
            new AbortController().signal, () => {}), { code: 'WRONG_WORKSPACE' });
        trusted = false;
        await assert.rejects(client.call('install_library', args, new AbortController().signal,
            () => {}), { code: 'WORKSPACE_UNTRUSTED' });
        assert.equal(calls, 0);
        trusted = true;
        await bridge.initialize();
        bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'install_library', arguments: args } });
        await started.promise;
        bridge.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
        assert.equal((await bridge.waitFor(message => message.id === 1)).error?.code, -32800);
        await aborted.promise;
        assert.equal(calls, 1, 'Canceled installation is not replayed');
    } finally { client.dispose(); await bridge.dispose(); await context.dispose(); }
});

test('MCP exposes only a sketch, optional profile and bounded log for read-only ESP32 decoding', () => {
    const tool = (getMcpTools() as Record<string, any>[]).find(value => value.name === 'decode_esp32_backtrace');
    assert.ok(tool);
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['log', 'profile', 'sketchPath']);
    assert.deepEqual(tool.inputSchema.required, ['sketchPath', 'log']);
    assert.equal(tool.inputSchema.properties.log.minLength, 1);
    assert.equal(tool.inputSchema.properties.log.maxLength, 8192);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.annotations, {
        title: 'Decode ESP32 Crash Backtrace', readOnlyHint: true, destructiveHint: false,
        idempotentHint: true, openWorldHint: false,
    });
});

test('MCP and authenticated IPC reject invalid crash logs and caller-selected decoder paths', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = await harness(context.sessionDirectory);
    const client = await AiIpcClient.connect(context.server.sessionFile);
    try {
        await bridge.initialize();
        const cases: Record<string, unknown>[] = [
            ...[undefined, '', ' \r\n\t ', 42, null, [], 'bad\x00log', 'bad\x07log', 'bad\x7flog',
                'x'.repeat(8193), '\u00e9'.repeat(4097)].map(log => ({ log })),
            { sketchPath: 'relative', log: 'Backtrace: 0x40012345' },
            ...[{ profile: '../release' }, { profile: '' }, { elfPath: '/tmp/other.elf' },
                { executable: 'shell' }, { toolPath: '/tmp/addr2line' }, { command: 'install' },
                { args: ['--arbitrary'] }, { clean: true }, { fqbn: 'other:esp32:board' }]
                .map(override => ({ log: 'Backtrace: 0x40012345', ...override })),
        ];
        let id = 1;
        for (const override of cases) {
            const args = { sketchPath: context.sketchPath, ...override };
            const requestId = id++;
            bridge.send({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: {
                name: 'decode_esp32_backtrace', arguments: args,
            } });
            assert.equal((await bridge.waitFor(message => message.id === requestId)).error?.code, -32602, JSON.stringify(override));
            await assert.rejects(client.call('decode_esp32_backtrace', args as Parameters<AiIpcClient['call']>[1],
                new AbortController().signal, () => {}), { code: 'INVALID_ARGUMENTS' });
        }
        assert.equal(calls, 0);
    } finally { client.dispose(); await bridge.dispose(); await context.dispose(); }
});

test('MCP routes a complete crash log and optional profile unchanged within UTF-8 byte limits', async () => {
    const received: unknown[] = [];
    const context = await fixture(async (name, input) => {
        received.push(input);
        assert.equal(name, 'decode_esp32_backtrace');
        return { schemaVersion: 1, status: 'success', frames: [{ address: '0x40012345', function: 'setup()', file: 'sketch.ino', line: 12 }] };
    });
    const bridge = await harness(context.sessionDirectory);
    try {
        await bridge.initialize();
        const logs = [
            '\x1b[31mGuru Meditation Error\x1b[0m\r\nBacktrace:\t0x40012345:0x3ffb0020\n',
            'x'.repeat(8192), '\u00e9'.repeat(4096),
        ];
        for (let index = 0; index < logs.length; index++) {
            const args = { sketchPath: context.sketchPath, ...(index === 0 ? { profile: 'release' } : {}), log: logs[index] };
            bridge.send({ jsonrpc: '2.0', id: index, method: 'tools/call', params: { name: 'decode_esp32_backtrace', arguments: args } });
            const response = await bridge.waitFor(message => message.id === index);
            assert.equal(response.error, undefined);
            assert.equal(response.result.isError, false);
            assert.equal(response.result.structuredContent.frames[0].line, 12);
            assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
            assert.deepEqual(received[index], args);
        }
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('ESP32 decoding retains IPC workspace, trust and cancellation guards', async () => {
    let calls = 0;
    let trusted = true;
    const started = deferred<void>();
    const aborted = deferred<void>();
    const context = await fixture(async (_name, _input, signal) => {
        calls++;
        started.resolve();
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
            aborted.resolve(); reject(new AiBridgeError('CANCELED', 'Canceled'));
        }, { once: true }));
    }, () => trusted);
    const client = await AiIpcClient.connect(context.server.sessionFile);
    const bridge = await harness(context.sessionDirectory);
    try {
        const args = { sketchPath: context.sketchPath, log: 'Backtrace: 0x40012345:0x3ffb0020' };
        await assert.rejects(client.call('decode_esp32_backtrace', { ...args, sketchPath: context.root },
            new AbortController().signal, () => {}), { code: 'WRONG_WORKSPACE' });
        trusted = false;
        await assert.rejects(client.call('decode_esp32_backtrace', args, new AbortController().signal,
            () => {}), { code: 'WORKSPACE_UNTRUSTED' });
        assert.equal(calls, 0);
        trusted = true;
        await bridge.initialize();
        bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'decode_esp32_backtrace', arguments: args } });
        await started.promise;
        bridge.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
        assert.equal((await bridge.waitFor(message => message.id === 1)).error?.code, -32800);
        await aborted.promise;
        assert.equal(calls, 1);
    } finally { client.dispose(); await bridge.dispose(); await context.dispose(); }
});

test('launcher rejects unsupported per-session and per-sketch arguments', async () => {
    const directory = path.resolve('private-ai-sessions');
    for (const args of [
        ['--session', path.join(directory, 'session.json')],
        ['--sketch', path.resolve('current-sketch'), '--session-dir', directory],
        ['--session-dir', directory, '--session', path.join(directory, 'session.json')],
        ['--session-dir'],
        [],
    ]) {
        await assert.rejects(main(args), /^Error: Usage: launcher\.cjs --session-dir <session-directory>$/);
    }
    await assert.rejects(main(['--session-dir', 'relative']), { code: 'INVALID_ARGUMENTS' });
});

test('MCP validates initialization, malformed input, unknown methods and tool schemas', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = await harness(context.sessionDirectory);
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
        for (const [id, name, args] of [[3, 'upload_sketch', { sketchPath: context.sketchPath }], [4, 'compile_sketch', {}], [5, 'list_ports', { sketchPath: context.sketchPath, clean: true }], [6, 'compile_sketch', { sketchPath: context.sketchPath, executable: 'shell' }], [7, 'list_dependencies', { sketchPath: context.sketchPath, args: ['install', 'unrequested'] }], [8, 'list_dependencies', { sketchPath: context.sketchPath, clean: true }]] as const) {
            bridge.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
            assert.equal((await bridge.waitFor(message => message.id === id)).error.code, -32602);
        }
        assert.equal(calls, 0);
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('MCP routes dependency inventory with an explicit profile through authenticated IPC', async () => {
    const calls: { name: AiToolName; input: unknown }[] = [];
    const context = await fixture(async (name, input) => {
        calls.push({ name, input });
        return { schemaVersion: 1, sketchPath: input.sketchPath, resolvedProfile: input.profile };
    });
    const bridge = await harness(context.sessionDirectory);
    try {
        await bridge.initialize();
        bridge.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
            name: 'list_dependencies', arguments: { sketchPath: context.sketchPath, profile: 'release' }
        } });
        const response = await bridge.waitFor(message => message.id === 1);
        assert.equal(response.result.isError, false);
        assert.equal(response.result.structuredContent.resolvedProfile, 'release');
        assert.deepEqual(calls, [{ name: 'list_dependencies', input: { sketchPath: context.sketchPath, profile: 'release' } }]);
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('MCP discovery schemas expose bounded searches and filters without arbitrary command or path inputs', () => {
    const tools = getMcpTools() as { name: string; inputSchema: { properties: Record<string, any> } }[];
    const properties = (name: string) => {
        const tool = tools.find(value => value.name === name);
        assert.ok(tool, `Missing ${name}`);
        return tool.inputSchema.properties;
    };
    const board = properties('get_board_details');
    assert.deepEqual(Object.keys(board).sort(), ['profile', 'sketchPath']);
    assert.equal(board.profile.maxLength, 64);
    assert.equal(board.profile.pattern, '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$');
    const search = properties('search_libraries');
    assert.deepEqual(Object.keys(search).sort(), ['limit', 'profile', 'query', 'sketchPath']);
    assert.equal(search.query.type, 'string');
    assert.equal(search.query.minLength, 1);
    assert.equal(search.query.maxLength, 256);
    assert.equal(search.limit.type, 'integer');
    assert.equal(search.limit.minimum, 1);
    assert.equal(search.limit.maximum, 100);
    assert.equal(search.limit.default, 20);
    const examples = properties('list_examples');
    assert.deepEqual(Object.keys(examples).sort(), ['library', 'limit', 'profile', 'sketchPath', 'source']);
    assert.deepEqual([...examples.source.enum].sort(), ['all', 'board', 'libraries']);
    assert.equal(examples.source.default, 'all');
    assert.equal(examples.library.type, 'string');
    assert.equal(examples.library.minLength, 1);
    assert.equal(examples.library.maxLength, 256);
    assert.equal(examples.limit.type, 'integer');
    assert.equal(examples.limit.minimum, 1);
    assert.equal(examples.limit.maximum, 100);
    assert.equal(examples.limit.default, 50);
});

test('MCP and authenticated IPC both reject invalid discovery inputs before handling them', async () => {
    let calls = 0;
    const context = await fixture(async () => { calls++; return {}; });
    const bridge = await harness(context.sessionDirectory);
    const client = await AiIpcClient.connect(context.server.sessionFile);
    try {
        await bridge.initialize();
        const cases: { name: AiToolName; args: Record<string, unknown> }[] = [];
        for (const name of ['get_board_details', 'search_libraries', 'list_examples'] as const) {
            const required = name === 'search_libraries' ? { query: 'sensor' } : {};
            for (const override of [
                { sketchPath: undefined }, { sketchPath: 'relative/sketch' }, { profile: '' },
                { profile: 'bad\nprofile' }, { profile: 42 }, { profile: 'has space' },
                { profile: '../profile' }, { profile: 'x'.repeat(65) }, { clean: true },
                { command: 'install' }, { executable: 'shell' }, { path: context.root },
                { args: ['--install'] }
            ]) {
                cases.push({ name, args: { sketchPath: context.sketchPath, ...required, ...override } });
            }
        }
        for (const query of [undefined, '', '   ', 42, null, 'sensor\ninstall', 'bad\x00query', 'bad\x7fquery', 'x'.repeat(257)]) {
            cases.push({ name: 'search_libraries', args: { sketchPath: context.sketchPath, query } });
        }
        for (const name of ['search_libraries', 'list_examples'] as const) {
            for (const limit of [0, 101, 1.5, '20', null]) {
                cases.push({ name, args: { sketchPath: context.sketchPath, ...(name === 'search_libraries' ? { query: 'sensor' } : {}), limit } });
            }
        }
        for (const source of ['platform', 'Board', '', null, 42]) {
            cases.push({ name: 'list_examples', args: { sketchPath: context.sketchPath, source } });
        }
        for (const library of ['', '   ', 42, null, 'library\nname', 'bad\x00name', 'bad\x7fname', 'x'.repeat(257)]) {
            cases.push({ name: 'list_examples', args: { sketchPath: context.sketchPath, library } });
        }
        cases.push({ name: 'get_board_details', args: { sketchPath: context.sketchPath, fqbn: 'unrequested:board:target' } });
        cases.push({ name: 'list_examples', args: { sketchPath: context.sketchPath, query: 'sensor' } });
        let id = 1;
        for (const { name, args } of cases) {
            const requestId = id++;
            bridge.send({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } });
            const response = await bridge.waitFor(message => message.id === requestId);
            assert.equal(response.error?.code, -32602, `${name}: ${JSON.stringify(args)}`);
            await assert.rejects(client.call(name, args as unknown as Parameters<AiIpcClient['call']>[1], new AbortController().signal, () => {}), { code: 'INVALID_ARGUMENTS' });
        }
        assert.equal(calls, 0, 'Invalid discovery requests must never reach extension operations');
    } finally { client.dispose(); await bridge.dispose(); await context.dispose(); }
});

test('MCP routes bounded discovery inputs and profiles through authenticated IPC', async () => {
    const calls: { name: AiToolName; input: unknown }[] = [];
    const context = await fixture(async (name, input) => {
        calls.push({ name, input });
        return { schemaVersion: 1, name, input };
    });
    const bridge = await harness(context.sessionDirectory);
    try {
        await bridge.initialize();
        const cases: { name: AiToolName; args: Record<string, unknown>; expected?: Record<string, unknown> }[] = [
            { name: 'get_board_details', args: { profile: 'release' } },
            { name: 'get_board_details', args: { profile: 'x'.repeat(64) } },
            { name: 'search_libraries', args: { profile: 'release', query: '  temperature sensor  ', limit: 1 }, expected: { profile: 'release', query: 'temperature sensor', limit: 1 } },
            { name: 'search_libraries', args: { query: 'x'.repeat(256), limit: 100 } },
            { name: 'list_examples', args: { profile: 'release', source: 'board', limit: 1 } },
            { name: 'list_examples', args: { source: 'libraries', library: '  Sensor Library  ', limit: 100 }, expected: { source: 'libraries', library: 'Sensor Library', limit: 100 } },
            { name: 'list_examples', args: { source: 'all', library: 'x'.repeat(256), limit: 50 } },
        ];
        let id = 1;
        for (const { name, args, expected } of cases) {
            const requestId = id++;
            bridge.send({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: { sketchPath: context.sketchPath, ...args } } });
            const response = await bridge.waitFor(message => message.id === requestId);
            assert.equal(response.error, undefined, JSON.stringify(response));
            assert.equal(response.result.isError, false, JSON.stringify(response));
            const expectedInput = { sketchPath: context.sketchPath, ...(expected ?? args) };
            assert.deepEqual(response.result.structuredContent, { schemaVersion: 1, name, input: expectedInput });
            assert.deepEqual(calls[calls.length - 1], { name, input: expectedInput });
        }
        assert.equal(calls.length, cases.length);
    } finally { await bridge.dispose(); await context.dispose(); }
});

test('new discovery tools retain IPC workspace and trust guards', async () => {
    let calls = 0;
    let trusted = true;
    const context = await fixture(async () => { calls++; return {}; }, () => trusted);
    const client = await AiIpcClient.connect(context.server.sessionFile);
    try {
        for (const name of ['get_board_details', 'search_libraries', 'list_examples'] as const) {
            const args = name === 'search_libraries' ? { query: 'sensor' } : {};
            await assert.rejects(client.call(name, { sketchPath: context.root, ...args }, new AbortController().signal, () => {}), { code: 'WRONG_WORKSPACE' });
        }
        trusted = false;
        for (const name of ['get_board_details', 'search_libraries', 'list_examples'] as const) {
            const args = name === 'search_libraries' ? { query: 'sensor' } : {};
            await assert.rejects(client.call(name, { sketchPath: context.sketchPath, ...args }, new AbortController().signal, () => {}), { code: 'WORKSPACE_UNTRUSTED' });
        }
        assert.equal(calls, 0);
    } finally { client.dispose(); await context.dispose(); }
});

test('MCP returns structured and text results with progress and operation failures', async () => {
    let failed = false;
    const context = await fixture(async (_name, input, _signal, progress) => {
        progress({ message: 'Inspecting selected profile' });
        if (failed) { throw new AiBridgeError('MISSING_CORE', 'Install the selected board package in VS Code.'); }
        return { schemaVersion: 1, sketchPath: input.sketchPath, status: 'success' };
    });
    const bridge = await harness(context.sessionDirectory);
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
        const bridge = await harness(context.sessionDirectory);
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
    const bridge = await harness(context.sessionDirectory);
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
    const bridge = await harness(context.sessionDirectory);
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
