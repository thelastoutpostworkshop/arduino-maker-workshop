import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { AiBridgeError, type AiToolHandler } from '../contracts';
import { AiIpcClient, createAiIpcServer, readSessionDescriptor } from '../ipcServer';
import { AiSessionResolver } from '../sessionDiscovery';

async function fixture(context: TestContext) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-discovery-'));
    const sketchPath = path.join(root, 'Blink');
    const otherSketch = path.join(root, 'Other');
    const sessionDirectory = path.join(root, 'sessions');
    await fs.mkdir(sketchPath);
    await fs.mkdir(otherSketch);
    const servers: Awaited<ReturnType<typeof createAiIpcServer>>[] = [];
    const resolver = await AiSessionResolver.createGlobal(sessionDirectory);
    context.after(async () => {
        resolver.dispose();
        await Promise.all(servers.map(server => server.dispose()));
        await fs.rm(root, { recursive: true, force: true });
    });
    return {
        root, sketchPath, otherSketch, sessionDirectory, resolver,
        async connect(marker: string, sketch = sketchPath, handler: AiToolHandler = async () => ({ marker })) {
            const server = await createAiIpcServer({ sessionDirectory, sketchPath: sketch, isTrusted: () => true, handler });
            servers.push(server);
            return server;
        },
    };
}

async function marker(client: AiIpcClient, sketchPath: string): Promise<unknown> {
    return client.call('get_project_context', { sketchPath }, new AbortController().signal, () => {});
}

test('sketch discovery works before integration is enabled and follows a fresh session after restart', async context => {
    const f = await fixture(context);
    await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'SESSION_UNAVAILABLE' });
    const first = await f.connect('first');
    const client = await f.resolver.getClient(f.sketchPath);
    assert.deepEqual(await marker(client, f.sketchPath), { marker: 'first' });
    assert.equal(await f.resolver.getClient(f.sketchPath), client);
    await first.dispose();
    await f.connect('second');
    const replacement = await f.resolver.getClient(f.sketchPath);
    assert.notEqual(replacement, client);
    assert.deepEqual(await marker(replacement, f.sketchPath), { marker: 'second' });
});

test('targeted discovery never probes other sketches or selects them in place of the requested sketch', async context => {
    const f = await fixture(context);
    await f.connect('other', f.otherSketch);
    const original = AiIpcClient.connect;
    const probed: string[] = [];
    context.mock.method(AiIpcClient, 'connect', async (file: string, signal?: AbortSignal) => {
        probed.push(file);
        return original.call(AiIpcClient, file, signal);
    });
    await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'SESSION_UNAVAILABLE' });
    assert.deepEqual(probed, []);
    const selected = await f.connect('selected');
    assert.deepEqual(await marker(await f.resolver.getClient(f.sketchPath), f.sketchPath), { marker: 'selected' });
    assert.deepEqual(probed, [selected.sessionFile]);
});

test('ambiguity closes new probes while preserving the already authenticated client', async context => {
    const f = await fixture(context);
    await f.connect('first');
    const current = await f.resolver.getClient(f.sketchPath);
    const second = await f.connect('second');
    const original = AiIpcClient.connect;
    const probes: AiIpcClient[] = [];
    context.mock.method(AiIpcClient, 'connect', async (file: string, signal?: AbortSignal) => {
        const client = await original.call(AiIpcClient, file, signal);
        probes.push(client);
        return client;
    });
    await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'AMBIGUOUS_SESSION' });
    assert.equal(current.connected, true);
    assert.equal(probes.length, 1);
    assert.equal(probes[0].connected, false);
    assert.deepEqual(await marker(current, f.sketchPath), { marker: 'first' });
    await second.dispose();
    assert.equal(await f.resolver.getClient(f.sketchPath), current);
});

test('invalid and definitely stale session files do not hide the live matching session', async context => {
    const f = await fixture(context);
    const stale = await f.connect('stale');
    const descriptor = await readSessionDescriptor(stale.sessionFile);
    await stale.dispose();
    await fs.mkdir(path.dirname(stale.sessionFile), { mode: 0o700 });
    await fs.writeFile(stale.sessionFile, JSON.stringify(descriptor), { mode: 0o600 });
    const invalid = path.join(f.sessionDirectory, 'session-invalid');
    await fs.mkdir(invalid, { mode: 0o700 });
    await fs.writeFile(path.join(invalid, 'session.json'), '{broken', { mode: 0o600 });
    await f.connect('live');
    assert.deepEqual(await marker(await f.resolver.getClient(f.sketchPath), f.sketchPath), { marker: 'live' });
});

test('an inconclusive matching probe fails closed instead of selecting another live session', async context => {
    const f = await fixture(context);
    const sessions = [await f.connect('first'), await f.connect('unknown')].sort((left, right) => left.sessionFile < right.sessionFile ? -1 : 1);
    const first = sessions[0];
    const current = await AiIpcClient.connect(first.sessionFile);
    context.after(() => current.dispose());
    context.mock.method(AiIpcClient, 'connect', async (file: string) => {
        if (file === first.sessionFile) { return current; }
        throw Object.assign(new AiBridgeError('SESSION_UNAVAILABLE', 'Connection reset'), { cause: { code: 'ECONNRESET' } });
    });
    await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'SESSION_UNAVAILABLE' });
    assert.equal(current.connected, false, 'any successfully opened probe must be disposed after a failed scan');
});

test('discovery bounds fail before selecting from a partial directory listing', async context => {
    for (const kind of ['sessions', 'entries'] as const) {
        const f = await fixture(context);
        await f.connect('live');
        const count = kind === 'sessions' ? 128 : 512;
        await Promise.all(Array.from({ length: count }, (_value, index) => kind === 'sessions'
            ? fs.mkdir(path.join(f.sessionDirectory, `session-empty-${index}`), { mode: 0o700 })
            : fs.writeFile(path.join(f.sessionDirectory, `unrelated-${index}`), '')));
        await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'SESSION_UNAVAILABLE' });
    }
});

test('concurrent discovery is shared and disposal rejects waiters and closes late probe clients', async context => {
    const f = await fixture(context);
    const server = await f.connect('live');
    const lateClient = await AiIpcClient.connect(server.sessionFile);
    context.after(() => lateClient.dispose());
    let release!: (client: AiIpcClient) => void;
    let started!: (signal: AbortSignal) => void;
    const waiting = new Promise<AiIpcClient>(resolve => { release = resolve; });
    const connecting = new Promise<AbortSignal>(resolve => { started = resolve; });
    let attempts = 0;
    context.mock.method(AiIpcClient, 'connect', async (_file: string, signal?: AbortSignal) => {
        attempts++;
        assert.ok(signal);
        started(signal);
        return waiting;
    });
    const first = f.resolver.getClient(f.sketchPath);
    const second = f.resolver.getClient(f.sketchPath);
    const rejected = assert.rejects(first, { code: 'SESSION_UNAVAILABLE' });
    const secondRejected = assert.rejects(second, { code: 'SESSION_UNAVAILABLE' });
    const signal = await connecting;
    f.resolver.dispose();
    await Promise.all([rejected, secondRejected]);
    assert.equal(signal.aborted, true);
    assert.equal(attempts, 1);
    release(lateClient);
    await delay(0);
    assert.equal(lateClient.connected, false);
    await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'SESSION_UNAVAILABLE' });
});

test('global discovery lists authenticated sketches without session details and requires an explicit target', async context => {
    const f = await fixture(context);
    assert.deepEqual(await f.resolver.listSketches(), { schemaVersion: 1, sketches: [] });
    await assert.rejects(f.resolver.getClient(undefined as unknown as string), { code: 'INVALID_ARGUMENTS' });
    await assert.rejects(f.resolver.getClient('Blink'), { code: 'INVALID_ARGUMENTS' });
    const first = await f.connect('first');
    const other = await f.connect('other', f.otherSketch);
    const listed = await f.resolver.listSketches();
    assert.deepEqual(listed, { schemaVersion: 1, sketches: [
        { sketchPath: await fs.realpath(f.sketchPath), sessionCount: 1 },
        { sketchPath: await fs.realpath(f.otherSketch), sessionCount: 1 },
    ] });
    const serialized = JSON.stringify(listed);
    for (const server of [first, other]) {
        const descriptor = await readSessionDescriptor(server.sessionFile);
        for (const secret of [descriptor.token, descriptor.sessionId, descriptor.endpoint, server.sessionFile]) {
            assert.equal(serialized.includes(secret), false);
        }
    }
    const [left, right] = await Promise.all([f.resolver.getClient(f.sketchPath), f.resolver.getClient(f.otherSketch)]);
    assert.deepEqual(await marker(left, f.sketchPath), { marker: 'first' });
    assert.deepEqual(await marker(right, f.otherSketch), { marker: 'other' });
    await first.dispose();
    await f.connect('restarted');
    assert.deepEqual(await marker(await f.resolver.getClient(f.sketchPath), f.sketchPath), { marker: 'restarted' });
    assert.equal(right.connected, true, 'reconnecting one sketch must preserve the other sketch connection');
});

test('global listing exposes duplicate counts and routing another sketch preserves in-flight work', async context => {
    const f = await fixture(context);
    let started!: () => void;
    let release!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    await f.connect('first', f.sketchPath, async (_name, _input, signal) => {
        await new Promise<void>((resolve, reject) => {
            release = resolve;
            signal.addEventListener('abort', () => reject(new Error('The first sketch operation was canceled')), { once: true });
            started();
        });
        return { marker: 'first' };
    });
    await f.connect('other', f.otherSketch);
    const current = await f.resolver.getClient(f.sketchPath);
    const outcome = marker(current, f.sketchPath).then(value => ({ value }), error => ({ error }));
    await running;
    try {
        const other = await f.resolver.getClient(f.otherSketch);
        await f.connect('duplicate');
        const listed = await f.resolver.listSketches();
        assert.equal(listed.sketches.find(sketch => sketch.sketchPath === current.sketchPath)?.sessionCount, 2);
        await assert.rejects(f.resolver.getClient(f.sketchPath), { code: 'AMBIGUOUS_SESSION' });
        assert.equal(current.connected, true);
        assert.equal(other.connected, true);
        assert.deepEqual(await marker(other, f.otherSketch), { marker: 'other' });
    } finally { release(); }
    assert.deepEqual(await outcome, { value: { marker: 'first' } });
});

test('global routing ignores an inconclusive other-sketch session and listing failure preserves cached work', async context => {
    const f = await fixture(context);
    const first = await f.connect('first');
    const other = await f.connect('other', f.otherSketch);
    const original = AiIpcClient.connect;
    const probed: string[] = [];
    context.mock.method(AiIpcClient, 'connect', async (file: string, signal?: AbortSignal) => {
        probed.push(file);
        if (file === other.sessionFile) {
            throw Object.assign(new AiBridgeError('SESSION_UNAVAILABLE', 'Connection reset'), { cause: { code: 'ECONNRESET' } });
        }
        return original.call(AiIpcClient, file, signal);
    });
    const current = await f.resolver.getClient(f.sketchPath);
    assert.deepEqual(probed, [first.sessionFile]);
    await assert.rejects(f.resolver.listSketches(), { code: 'SESSION_UNAVAILABLE' });
    assert.equal(current.connected, true);
    assert.equal(await f.resolver.getClient(f.sketchPath), current);
    await assert.rejects(f.resolver.getClient(f.otherSketch), { code: 'SESSION_UNAVAILABLE' });
});

test('global discovery rejects invalid or unavailable targets without selecting another sketch', async context => {
    const f = await fixture(context);
    await f.connect('first');
    await f.connect('other', f.otherSketch);
    await assert.rejects(f.resolver.getClient(''), { code: 'INVALID_ARGUMENTS' });
    await assert.rejects(f.resolver.getClient(path.join(f.root, 'missing')), { code: 'SESSION_UNAVAILABLE' });
    const file = path.join(f.root, 'not-a-directory');
    await fs.writeFile(file, '');
    await assert.rejects(f.resolver.getClient(file), { code: 'SESSION_UNAVAILABLE' });
    assert.deepEqual(await f.resolver.listSketches(), { schemaVersion: 1, sketches: [
        { sketchPath: await fs.realpath(f.sketchPath), sessionCount: 1 },
        { sketchPath: await fs.realpath(f.otherSketch), sessionCount: 1 },
    ] });
});
