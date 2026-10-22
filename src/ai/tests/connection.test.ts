import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import * as ts from 'typescript';
import { AiBridgeError } from '../contracts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture(nativeApi = true) {
    const commands = new Map<string, () => Promise<void>>();
    let approve: () => Promise<string | undefined> = async () => 'Connect This Session';
    let created = 0;
    let disposed = 0;
    let shown = 0;
    let writes = 0;
    let sketch = 'C:\\sketch';
    const errors: string[] = [];
    const setups: string[] = [];
    let createSession: () => Promise<unknown> = async () => ({
        sessionFile: 'C:\\private\\session.json', sessionId: 'test-session', dispose: async () => { disposed++; },
    });
    let folderChange = () => {};
    class Definition {
        constructor(public label: string, public command: string, public args: string[], public env: Record<string, string>, public version: string) {}
    }
    let provider: { provideMcpServerDefinitions(): Definition[] } | undefined;
    class Disposable { constructor(private readonly close: () => void = () => {}) {} dispose() { this.close(); } }
    class Emitter { event = () => new Disposable(); fire() {} dispose() {} }
    const vscode = {
        Disposable, EventEmitter: Emitter,
        env: { remoteName: undefined },
        commands: { registerCommand: (name: string, handler: () => Promise<void>) => { commands.set(name, handler); return new Disposable(); } },
        workspace: {
            isTrusted: true,
            openTextDocument: async (document: { content: string }) => { setups.push(document.content); return {}; },
            onDidChangeWorkspaceFolders: (handler: () => void) => { folderChange = handler; return new Disposable(); },
        },
        window: {
            showWarningMessage: () => approve(), showTextDocument: async () => { shown++; },
            showErrorMessage: async (message: string) => { errors.push(message); }, showInformationMessage: async () => {},
        },
        ...(nativeApi ? {
            lm: { registerMcpServerDefinitionProvider: (_name: string, value: typeof provider) => { provider = value; return new Disposable(); } },
            McpStdioServerDefinition: Definition,
        } : {}),
    };
    const filename = path.join(process.cwd(), 'src/ai/connection.ts');
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as { registerAiConnection: (...args: unknown[]) => Disposable } };
    const customRequire = (name: string) => {
        if (name === 'vscode') { return vscode; }
        if (name === './contracts') { return { AiBridgeError }; }
        if (name === './ipcServer') { return { createAiIpcServer: async () => { created++; return createSession(); } }; }
        if (name === 'node:fs') { return { mkdirSync: () => { writes++; }, copyFileSync: () => { writes++; }, renameSync: () => { writes++; } }; }
        if (name === 'node:path') { return path; }
        throw new Error(`Unexpected module ${name}`);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(customRequire, module, module.exports);
    const registration = module.exports.registerAiConnection(
        { globalStorageUri: { fsPath: 'C:\\private' }, extensionPath: 'C:\\extension', extension: { packageJSON: { version: 'test' } } },
        { handler: async () => ({}), ready: () => true, activeSketchPath: () => sketch },
    );
    return {
        connect: () => commands.get('arduinoMakerWorkshop.connectAiAssistant')!(),
        disconnect: () => commands.get('arduinoMakerWorkshop.disconnectAiAssistant')!(),
        registration, vscode, folderChange: () => folderChange(), errors, setups,
        counts: () => ({ created, disposed, shown, writes }),
        definitions: () => provider?.provideMcpServerDefinitions(),
        approve: (callback: typeof approve) => { approve = callback; },
        createSession: (callback: typeof createSession) => { createSession = callback; },
        changeSketch: () => { sketch = 'C:\\other'; },
    };
}

function setupArguments(markdown: string): string[][] {
    return [...markdown.matchAll(/```(json|toml)\n([\s\S]*?)\n```/g)].map(([, language, content]) => {
        if (language === 'toml') {
            return JSON.parse(/^args = (.+)$/m.exec(content)![1]);
        }
        const config = JSON.parse(content);
        return (config.servers ?? config.mcpServers).arduino_maker_workshop.args;
    });
}

test('registering commands creates no listener, file, or session and supports pre-MCP VS Code', async () => {
    const f = fixture(false);
    assert.deepEqual(f.counts(), { created: 0, disposed: 0, shown: 0, writes: 0 });
    assert.equal(f.definitions(), undefined);
    await f.connect();
    assert.equal(f.counts().created, 1);
    await f.disconnect();
    assert.equal(f.counts().disposed, 1);
});

test('connection requires explicit approval and workspace trust', async () => {
    const declined = fixture(); declined.approve(async () => undefined);
    await declined.connect();
    assert.equal(declined.counts().created, 0);
    const untrusted = fixture(); untrusted.vscode.workspace.isTrusted = false;
    await untrusted.connect();
    assert.equal(untrusted.counts().created, 0);
    assert.equal(untrusted.errors.length, 1);
});

test('Disconnect while approval is pending prevents late enablement', async () => {
    const consent = deferred<string | undefined>();
    const f = fixture(); f.approve(() => consent.promise);
    const connect = f.connect();
    await f.disconnect();
    consent.resolve('Connect This Session');
    await connect;
    assert.equal(f.counts().created, 0);
    assert.equal(f.counts().writes, 0);
});

test('Disconnect or disposal during asynchronous session creation revokes the new listener', async () => {
    for (const disposeRegistration of [false, true]) {
        const pending = deferred<unknown>();
        const f = fixture(); f.createSession(() => pending.promise);
        const connect = f.connect();
        await Promise.resolve();
        if (disposeRegistration) { f.registration.dispose(); } else { await f.disconnect(); }
        let closed = 0;
        pending.resolve({ sessionId: 'late', sessionFile: 'private', dispose: async () => { closed++; } });
        await connect;
        assert.equal(closed, 1);
        assert.equal(f.counts().shown, 0);
        assert.deepEqual(f.definitions(), []);
    }
});

test('workspace changes during connection discard stale sessions', async () => {
    const pending = deferred<unknown>();
    const f = fixture(); f.createSession(() => pending.promise);
    const connect = f.connect();
    await Promise.resolve();
    f.changeSketch(); f.folderChange();
    let closed = 0;
    pending.resolve({ sessionId: 'late', sessionFile: 'private', dispose: async () => { closed++; } });
    await connect;
    assert.equal(closed, 1);
    assert.deepEqual(f.definitions(), []);
});

test('provider advertises only an enabled session and drops it immediately on disconnect', async () => {
    const f = fixture();
    assert.deepEqual(f.definitions(), []);
    await f.connect();
    assert.equal(f.definitions()?.length, 1);
    assert.equal(f.counts().shown, 1);
    await f.disconnect();
    assert.deepEqual(f.definitions(), []);
    assert.equal(f.counts().disposed, 1);
});

test('external and native setup remain stable across session replacement', async () => {
    const f = fixture();
    await f.connect();
    const initialDefinition = f.definitions()![0];
    const directory = path.join('C:\\private', 'ai-bridge');
    const launcher = path.join(directory, 'launcher.cjs');
    const expectedArgs = [launcher, '--session-dir', directory];
    assert.deepEqual(setupArguments(f.setups[0]), [expectedArgs, expectedArgs, expectedArgs]);
    const rawArguments = [...f.setups[0].matchAll(/Argument \d+:\n\n```text\n([^\n]+)\n```/g)].map(match => match[1]);
    assert.deepEqual(rawArguments, expectedArgs, 'Desktop setup must provide exactly three raw arguments');
    assert.deepEqual(initialDefinition.args, expectedArgs);
    assert.equal(initialDefinition.label, 'Arduino Maker Workshop');
    assert.equal(initialDefinition.version, 'test');

    await f.disconnect();
    f.createSession(async () => ({ sessionFile: 'C:\\private\\new-session.json', sessionId: 'new-session', dispose: async () => {} }));
    await f.connect();
    assert.equal(f.setups[1], f.setups[0], 'Client setup must not depend on an ephemeral session ID or descriptor path');
    const replacementDefinition = f.definitions()![0];
    assert.deepEqual(replacementDefinition, initialDefinition, 'Native server identity must not include an ephemeral session');
    await f.disconnect();
});

test('external and native setup remain stable when connecting a different sketch', async () => {
    const f = fixture();
    await f.connect();
    const originalDefinition = f.definitions()![0];
    await f.disconnect();
    f.changeSketch();
    await f.connect();
    const oldArguments = setupArguments(f.setups[0]);
    const newArguments = setupArguments(f.setups[1]);
    assert.equal(newArguments.length, 3);
    assert.deepEqual(newArguments, oldArguments, 'A different sketch must reuse the same client configuration');
    assert.deepEqual(f.definitions()![0], originalDefinition, 'Native server identity must not include the current sketch');
    assert.ok(f.setups[1].includes('C:\\other'), 'The guide should still identify the sketch this window enabled');
    await f.disconnect();
});
