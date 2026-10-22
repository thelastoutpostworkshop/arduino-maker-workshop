import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import * as ts from 'typescript';
import { parseTOML, getStaticTOMLValue } from 'toml-eslint-parser';
import type { AiIntegrationState } from '../../shared/messages';
import type { AiClientLaunch } from '../clientSetup';
import { AiBridgeError } from '../contracts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function configuration(enabled = false) {
    return {
        enabled, workspaceEnabled: false,
        listeners: new Set<(key?: string) => void>(), write: async (_enabled: boolean) => {},
    };
}

function fixture(initial: { nativeApi?: boolean | 'throws'; settings?: ReturnType<typeof configuration>; ready?: boolean; trusted?: boolean; remote?: string; validSketch?: boolean; execPath?: string } = {}) {
    const commands = new Map<string, (...args: unknown[]) => unknown>();
    const settings = initial.settings ?? configuration();
    let created = 0, disposed = 0, shown = 0, writes = 0, warnings = 0;
    let ready = initial.ready ?? true;
    let validSketch = initial.validSketch ?? true;
    let sketch: string | undefined = path.resolve('test-sketch');
    const setups: string[] = [], information: string[] = [], executed: string[] = [];
    const states: AiIntegrationState[] = [];
    const preferences: { enabled: boolean; target: number }[] = [];
    const clientCalls: { client: string; launch: AiClientLaunch }[] = [];
    const sessionOptions: { sketchPath: string; isTrusted(): boolean }[] = [];
    let createSession: () => Promise<unknown> = async () => ({
        sessionFile: 'private/session.json', sessionId: 'test-session', dispose: async () => { disposed++; },
    });
    let setupClient = async (_client: string, _launch: AiClientLaunch) => ({ configPath: '/private/client-config', changed: true });
    let execute = async (_command: string) => {};
    let notify = async (_message: string) => {};
    let picker = async () => ({ client: 'codex' });
    let observe = (_state: AiIntegrationState) => {};
    let folderChange = () => {};
    let trustChange = () => {};
    class Definition {
        constructor(public label: string, public command: string, public args: string[], public env: Record<string, string>, public version: string) {}
    }
    let provider: { provideMcpServerDefinitions(): Definition[]; resolveMcpServerDefinition(definition: unknown): unknown } | undefined;
    class Disposable { constructor(private readonly close: () => void = () => {}) {} dispose() { this.close(); } }
    class Emitter { event = () => new Disposable(); fire() {} dispose() {} }
    const vscode = {
        Disposable, EventEmitter: Emitter, ConfigurationTarget: { Global: 1 },
        env: { remoteName: initial.remote },
        commands: {
            registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => { commands.set(name, handler); return new Disposable(); },
            executeCommand: async (name: string) => { executed.push(name); return execute(name); },
        },
        workspace: {
            isTrusted: initial.trusted ?? true,
            getConfiguration: () => ({
                inspect: (key: string) => {
                    assert.equal(key, 'ai.enabled');
                    return { globalValue: settings.enabled, workspaceValue: settings.workspaceEnabled };
                },
                update: async (key: string, enabled: boolean, target: number) => {
                    assert.equal(key, 'ai.enabled');
                    preferences.push({ enabled, target }); await settings.write(enabled);
                    settings.enabled = enabled;
                    settings.listeners.forEach(listener => listener(`arduinoMakerWorkshop.${key}`));
                },
            }),
            openTextDocument: async (document: { content: string }) => { setups.push(document.content); return {}; },
            onDidChangeWorkspaceFolders: (handler: () => void) => { folderChange = handler; return new Disposable(); },
            onDidGrantWorkspaceTrust: (handler: () => void) => { trustChange = handler; return new Disposable(); },
            onDidChangeConfiguration: (handler: (event: { affectsConfiguration(key: string): boolean }) => void) => {
                const listener = (changedKey = 'arduinoMakerWorkshop.ai.enabled') => handler({ affectsConfiguration: key => key === changedKey });
                settings.listeners.add(listener); return new Disposable(() => settings.listeners.delete(listener));
            },
        },
        window: {
            showWarningMessage: async () => { warnings++; }, showTextDocument: async () => { shown++; },
            showInformationMessage: async (message: string) => { information.push(message); return notify(message); }, showQuickPick: () => picker(),
        },
        ...(initial.nativeApi !== false ? {
            lm: { registerMcpServerDefinitionProvider: (_name: string, value: typeof provider) => {
                if (initial.nativeApi === 'throws') { throw new Error('Proposed API unavailable'); }
                provider = value; return new Disposable();
            } }, McpStdioServerDefinition: Definition,
        } : {}),
    };
    const filename = path.join(process.cwd(), 'src/ai/connection.ts');
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as { registerAiConnection: (...args: unknown[]) => Disposable & { refresh(): Promise<void>; getState(): AiIntegrationState } } };
    const customRequire = (name: string) => {
        if (name === 'vscode') { return vscode; }
        if (name === './contracts') { return { AiBridgeError }; }
        if (name === './clientSetup') { return { setupAiClient: async (client: string, launch: AiClientLaunch) => {
            clientCalls.push({ client, launch }); return setupClient(client, launch);
        } }; }
        if (name === './ipcServer') { return { createAiIpcServer: async (options: typeof sessionOptions[number]) => {
            created++; sessionOptions.push(options); return createSession();
        } }; }
        if (name === 'node:fs') { return { statSync: () => ({ isFile: () => validSketch }), mkdirSync: () => { writes++; }, copyFileSync: () => { writes++; }, renameSync: () => { writes++; }, rmSync: () => {} }; }
        if (name === 'node:path') { return path; }
        throw new Error(`Unexpected module ${name}`);
    };
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`, { filename })(customRequire, module, module.exports, {
        pid: process.pid, execPath: initial.execPath ?? process.execPath,
    });
    const registration = module.exports.registerAiConnection(
        { globalStorageUri: { fsPath: path.resolve('private') }, extensionPath: path.resolve('extension'), extension: { packageJSON: { version: 'test' } } },
        { handler: async () => ({}), ready: () => ready, activeSketchPath: () => sketch, onStateChanged: (state: AiIntegrationState) => { states.push(state); observe(state); } },
    );
    const command = async (name: string, ...args: unknown[]) => commands.get(`arduinoMakerWorkshop.${name}`)!(...args);
    return {
        connect: () => command('enableAiIntegration'), disconnect: () => command('disableAiIntegration'),
        showSetup: () => command('showAiSetup'), setup: (client?: string) => command('setupAiClient', client),
        command, registration, vscode, settings, states, preferences, sessionOptions, clientCalls, executed, information, setups,
        hasCommand: (name: string) => commands.has(`arduinoMakerWorkshop.${name}`),
        folderChange: () => folderChange(), trustChange: () => trustChange(), counts: () => ({ created, disposed, shown, writes, warnings }),
        definitions: () => provider?.provideMcpServerDefinitions(), resolve: (definition: unknown) => provider?.resolveMcpServerDefinition(definition),
        createSession: (callback: typeof createSession) => { createSession = callback; }, setupClient: (callback: typeof setupClient) => { setupClient = callback; },
        execute: (callback: typeof execute) => { execute = callback; }, pick: (callback: typeof picker) => { picker = callback; },
        notify: (callback: typeof notify) => { notify = callback; },
        observe: (callback: typeof observe) => { observe = callback; },
        changeSketch: (value: string | undefined = path.resolve('other-sketch')) => { sketch = value; },
        ready: (value: boolean) => { ready = value; }, validSketch: (value: boolean) => { validSketch = value; }, flush: () => registration.refresh(),
    };
}

async function waitUntil(predicate: () => boolean) {
    for (let attempt = 0; attempt < 30 && !predicate(); attempt++) { await Promise.resolve(); }
    assert.ok(predicate(), 'Expected the asynchronous operation to start');
}

function setupDefinitions(markdown: string): AiClientLaunch[] {
    return [...markdown.matchAll(/```(json|toml)\n([\s\S]*?)\n```/g)].map(([, language, content]) => {
        const config = (language === 'toml' ? getStaticTOMLValue(parseTOML(content)) : JSON.parse(content)) as Record<string, Record<string, AiClientLaunch>>;
        const { command, args, env } = (config.servers ?? config.mcpServers ?? config.mcp_servers).arduino_maker_workshop;
        return { command, args, env };
    });
}

test('disabled by default, workspace settings cannot opt in, and manual guide starts no listener', async () => {
    const settings = configuration(); settings.workspaceEnabled = true;
    const f = fixture({ settings }); await f.flush(); await f.showSetup();
    assert.deepEqual(f.counts(), { created: 0, disposed: 0, shown: 1, writes: 0, warnings: 0 });
    assert.equal(f.registration.getState().status, 'disabled'); assert.deepEqual(f.definitions(), []); assert.equal(f.preferences.length, 0);
});

test('enable persists globally without a modal and reload restores a fresh session', async () => {
    const settings = configuration(); const first = fixture({ settings }); await first.connect();
    assert.deepEqual(first.preferences, [{ enabled: true, target: 1 }]); assert.equal(first.counts().created, 1); assert.equal(first.counts().warnings, 0);
    first.registration.dispose(); const reloaded = fixture({ settings }); await reloaded.flush();
    assert.equal(reloaded.counts().created, 1); assert.equal(reloaded.registration.getState().status, 'ready'); assert.equal(reloaded.preferences.length, 0);
    await reloaded.disconnect(); assert.equal(settings.enabled, false); assert.equal(reloaded.counts().disposed, 1);
    assert.equal(first.hasCommand('connectAiAssistant'), false);
    assert.equal(first.hasCommand('disconnectAiAssistant'), false);
});

test('remembered integration waits for Arduino CLI and workspace trust', async () => {
    const f = fixture({ settings: configuration(true), ready: false, trusted: false }); await f.flush();
    assert.equal(f.counts().created, 0); assert.match(f.registration.getState().message, /Trust this workspace/);
    f.vscode.workspace.isTrusted = true; f.trustChange(); await f.flush(); assert.match(f.registration.getState().message, /Arduino CLI/);
    f.ready(true); await f.flush(); assert.equal(f.counts().created, 1); assert.equal(f.registration.getState().status, 'ready');
});

test('remote and non-sketch folders remain waiting without listener or files', async () => {
    for (const unsupported of [{ remote: 'ssh-remote' }, { validSketch: false }]) {
        const f = fixture({ settings: configuration(true), ...unsupported }); await f.flush();
        assert.equal(f.registration.getState().status, 'waiting'); assert.equal(f.counts().created, 0); assert.equal(f.counts().writes, 0);
        await assert.rejects(f.setup('codex'), /local|Remote/); assert.equal(f.clientCalls.length, 0);
    }
});

test('unsupported native API falls back without breaking external integration', async () => {
    for (const nativeApi of [false, 'throws'] as const) {
        const f = fixture({ nativeApi }); await f.connect(); assert.equal(f.registration.getState().nativeMcpAvailable, false); assert.equal(f.counts().created, 1);
        await f.setup('copilot'); assert.equal(f.counts().shown, 1); assert.equal(f.executed.length, 0);
    }
});

test('global config changes connect and disable all open windows', async () => {
    const settings = configuration(); const first = fixture({ settings }); const second = fixture({ settings });
    await first.connect(); await second.flush(); assert.equal(second.counts().created, 1);
    await second.disconnect(); await first.flush(); assert.equal(first.counts().disposed, 1); assert.equal(first.registration.getState().status, 'disabled'); assert.deepEqual(first.definitions(), []);
});

test('refresh is idempotent for a ready sketch; sketch changes replace its session', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush(); await Promise.all([f.flush(), f.flush(), f.connect()]);
    f.folderChange(); await f.flush(); assert.equal(f.counts().created, 1);
    f.changeSketch(); f.folderChange(); await f.flush(); assert.equal(f.counts().created, 2); assert.equal(f.counts().disposed, 1); assert.equal(f.sessionOptions[1].sketchPath, path.resolve('other-sketch'));
});

test('native provider and request guard immediately refuse lost trust', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush(); const definition = f.definitions()![0]; assert.equal(f.resolve(definition), definition);
    f.vscode.workspace.isTrusted = false; assert.equal(f.sessionOptions[0].isTrusted(), false); assert.equal(f.resolve(definition), undefined); assert.deepEqual(f.definitions(), []);
    await f.flush(); assert.equal(f.counts().disposed, 1); assert.equal(f.registration.getState().status, 'waiting');
});

test('a refresh queued as reconciliation finishes is drained before it resolves', async () => {
    const f = fixture({ settings: configuration(true) });
    let changed = false;
    f.observe(state => {
        if (state.status === 'ready' && !changed) {
            changed = true;
            queueMicrotask(() => { f.changeSketch(); f.folderChange(); });
        }
    });
    await f.flush();
    assert.equal(f.counts().created, 2);
    assert.equal(f.counts().disposed, 1);
    assert.equal(f.sessionOptions[1].sketchPath, path.resolve('other-sketch'));
});

test('disable or disposal during creation closes a late listener without advertising it', async () => {
    for (const disposeRegistration of [false, true]) {
        const pending = deferred<unknown>(); const f = fixture({ settings: configuration(true) }); f.createSession(() => pending.promise);
        const started = f.flush(); await waitUntil(() => f.counts().created === 1);
        const stopped = disposeRegistration ? (f.registration.dispose(), Promise.resolve()) : f.disconnect(); assert.equal(f.sessionOptions[0].isTrusted(), false);
        let closed = 0; pending.resolve({ sessionId: 'late', sessionFile: 'private', dispose: async () => { closed++; } }); await Promise.all([started, stopped]);
        assert.equal(closed, 1); assert.deepEqual(f.definitions(), []); assert.equal(f.counts().shown, 0);
    }
});

test('stale creation is discarded before automatically connecting the new sketch', async () => {
    const pending = deferred<unknown>(); const f = fixture({ settings: configuration(true) }); f.createSession(() => pending.promise);
    const started = f.flush(); await waitUntil(() => f.counts().created === 1); f.changeSketch(); f.folderChange();
    f.createSession(async () => ({ sessionId: 'new', sessionFile: 'new', dispose: async () => {} }));
    let closed = 0; pending.resolve({ sessionId: 'old', sessionFile: 'old', dispose: async () => { closed++; } }); await started;
    assert.equal(closed, 1); assert.equal(f.counts().created, 2); assert.equal(f.registration.getState().status, 'ready');
});

test('sketch removed during creation never becomes available, even before a refresh', async () => {
    const pending = deferred<unknown>(); const f = fixture({ settings: configuration(true) }); f.createSession(() => pending.promise);
    const started = f.flush(); await waitUntil(() => f.counts().created === 1); f.validSketch(false);
    let closed = 0; pending.resolve({ dispose: async () => { closed++; } }); await started;
    assert.equal(closed, 1); assert.deepEqual(f.definitions(), []);
});

test('disable wins over an earlier pending global enable write', async () => {
    const pending = deferred<void>(); const settings = configuration(); settings.write = async enabled => { if (enabled) { await pending.promise; } };
    const f = fixture({ settings }); const enabling = f.connect(); await waitUntil(() => f.preferences.length === 1); const disabling = f.disconnect();
    pending.resolve(); await Promise.all([enabling, disabling]); assert.equal(settings.enabled, false); assert.equal(f.counts().created, 0); assert.equal(f.registration.getState().status, 'disabled');
});

test('a failed settings write does not silently enable integration', async () => {
    const settings = configuration(); settings.write = async () => { throw new Error('Settings are read-only'); }; const f = fixture({ settings });
    await assert.rejects(f.connect(), /Could not save/); assert.equal(f.counts().created, 0); assert.equal(f.registration.getState().status, 'disabled');
});

test('failed disable persistence keeps this window revoked until another explicit enable', async () => {
    const settings = configuration(true); const f = fixture({ settings }); await f.flush();
    settings.write = async () => { throw new Error('Settings are read-only'); };
    await assert.rejects(f.disconnect(), /Other windows may remain enabled/);
    await f.flush(); assert.equal(f.counts().disposed, 1); assert.equal(f.counts().created, 1); assert.deepEqual(f.definitions(), []);
    assert.equal(f.registration.getState().status, 'disabled'); assert.equal(settings.enabled, true);
    settings.write = async () => {}; await f.connect(); assert.equal(f.counts().created, 2);
});

test('startup failure is visible and an explicit refresh can retry', async () => {
    const f = fixture({ settings: configuration(true) }); f.createSession(async () => { throw new AiBridgeError('START_FAILED', 'Cannot listen'); }); await f.flush();
    assert.equal(f.registration.getState().status, 'error'); assert.equal(f.registration.getState().message, 'Cannot listen');
    f.createSession(async () => ({ dispose: async () => {} })); await f.flush(); assert.equal(f.registration.getState().status, 'ready');
});

test('external and native config stay stable across reloads and different sketches', async () => {
    const settings = configuration(true); const f = fixture({ settings }); await f.flush(); await f.showSetup(); const initial = f.definitions()![0];
    const directory = path.join(path.resolve('private'), 'ai-bridge'); const args = [path.join(directory, 'launcher.cjs'), '--session-dir', directory];
    const launch = { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: '1' } };
    assert.deepEqual(setupDefinitions(f.setups[0]), [launch, launch, launch]);
    const raw = [...f.setups[0].matchAll(/Argument \d+:\n\n```text\n([^\n]+)\n```/g)].map(match => match[1]); assert.deepEqual(raw, args);
    assert.equal(initial.label, 'Arduino Maker Workshop'); assert.equal(initial.version, 'test'); f.registration.dispose();
    const restarted = fixture({ settings }); restarted.changeSketch(); await restarted.flush(); await restarted.showSetup();
    assert.deepEqual(setupDefinitions(restarted.setups[0]), [launch, launch, launch]); assert.deepEqual({ ...restarted.definitions()![0] }, { ...initial });
    assert.match(restarted.setups[0], /automatically.*trusted local sketch/);
});

test('client setup uses the same bundled runtime as Copilot and makes restart guidance visible', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush(); await f.setup('codex'); await f.setup('claude');
    const { command, args, env } = f.definitions()![0];
    assert.deepEqual(f.clientCalls.map(call => call.client), ['codex', 'claude']);
    assert.deepEqual(f.clientCalls[0].launch, { command, args, env });
    assert.deepEqual(f.clientCalls[1].launch, f.clientCalls[0].launch);
    assert.equal(command, process.execPath);
    assert.deepEqual(env, { ELECTRON_RUN_AS_NODE: '1' });
    assert.match(f.information[0], /Restart/); assert.match(f.registration.getState().message, /new Claude Code conversation/); assert.equal(f.registration.getState().busy, false);
    const state = await f.command('getAiIntegrationState') as AiIntegrationState; state.message = 'changed by caller'; assert.notEqual(f.registration.getState().message, state.message);
});

test('manual and automatic setup preserve exact runtime paths and required environment', async () => {
    for (const execPath of [
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
        '/opt/VS Code "test"/code',
    ]) {
        const f = fixture({ settings: configuration(true), execPath });
        await f.flush(); await f.showSetup(); await f.setup('codex'); await f.setup('claude');
        const { command, args, env } = f.definitions()![0];
        const launch = { command, args, env };
        assert.equal(command, execPath);
        assert.deepEqual(env, { ELECTRON_RUN_AS_NODE: '1' });
        assert.deepEqual(setupDefinitions(f.setups[0]), [launch, launch, launch]);
        assert.deepEqual(f.clientCalls.map(call => call.launch), [launch, launch]);
        assert.ok(f.setups[0].includes(`\n\n\`\`\`text\n${execPath}\n\`\`\``));
        assert.match(f.setups[0], /No separate Node\.js installation is needed/);
        assert.match(f.setups[0], /Environment variable: set ELECTRON_RUN_AS_NODE to 1/);
        f.registration.dispose();
    }
});

test('a successful setup does not wait for its notification to be dismissed', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush();
    const pending = deferred<void>(); f.notify(() => pending.promise);
    await f.setup('codex'); assert.equal(f.registration.getState().busy, false); pending.resolve();
});

test('setup refuses disabled integration and serializes concurrent client writes', async () => {
    const f = fixture(); await f.flush(); await assert.rejects(f.setup('codex'), /Enable AI Integration/); assert.equal(f.clientCalls.length, 0); await f.connect();
    const pending = deferred<{ configPath: string; changed: boolean }>(); f.setupClient(() => pending.promise);
    const first = f.setup('codex'); await waitUntil(() => f.clientCalls.length === 1); await f.setup('claude'); assert.equal(f.clientCalls.length, 1); assert.equal(f.registration.getState().busy, true);
    pending.resolve({ configPath: '/client', changed: false }); await first; assert.equal(f.registration.getState().busy, false);
});

test('client setup failures preserve actionable errors and release the busy state', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush(); f.setupClient(async () => { throw new AiBridgeError('CONFIG_CONFLICT', 'The configuration changed; retry setup.'); });
    await assert.rejects(f.setup('codex'), /configuration changed/); assert.equal(f.registration.getState().busy, false); assert.match(f.registration.getState().message, /configuration changed/); assert.equal(f.definitions()?.length, 1);
});

test('palette chooser and Copilot list use native setup with manual fallback', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush(); f.pick(async () => ({ client: 'claude' })); await f.setup(); assert.equal(f.clientCalls[0].client, 'claude');
    await f.setup('copilot'); assert.deepEqual(f.executed, ['workbench.mcp.listServer']);
    f.execute(async () => { throw new Error('Command unavailable'); }); await f.setup('copilot'); assert.equal(f.counts().shown, 1); assert.equal(f.clientCalls.length, 1);
});

test('ready state and setup guide explain automatic compilation without an approval setting', async () => {
    const f = fixture({ settings: configuration(true) }); await f.flush(); await f.showSetup();
    assert.match(f.registration.getState().message, /without extension approval prompts/);
    assert.equal('confirmCompile' in f.registration.getState(), false);
    assert.equal(f.hasCommand('setAiCompileApproval'), false);
    assert.match(f.setups[0], /Compilation starts without an extension approval prompt/);
    assert.match(f.setups[0], /Your AI client controls its own tool permissions/);
    assert.doesNotMatch(f.setups[0], /Ask before AI compilation|ai\.confirmCompile|time for approval/);
    assert.equal(f.counts().warnings, 0);
    assert.equal(f.preferences.length, 0);
});
