import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test, type TestContext } from 'node:test';
import * as ts from 'typescript';
import { AiBridgeError, type AiOperationResult, type OperationProgress, type ProjectInspection } from '../contracts';
import { inspectProject } from '../projectInspection';
import { runProcess, type ProcessOptions, type ProcessResult } from '../processRunner';
import * as redaction from '../redaction';

interface TestedCli {
    arduinoCLIPath: string;
    compileOrUploadRunning: boolean;
    compileForAssistant(target: ProjectInspection, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<AiOperationResult>;
    discoverForAssistant(kind: 'boards' | 'ports', signal: AbortSignal): Promise<unknown>;
    invalidateAssistantBuild(target: ProjectInspection): void;
}

const filename = path.resolve(__dirname, '../../../src/cli.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loadCli = vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename }) as
    (requireModule: (id: string) => unknown, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void;

/** Only cli.ts is loaded through this host. No extension activation or Arduino process runs. */
function host(t: TestContext, compiler = 'process.stdout.write("compiled\\n");') {
    const fixtureRoot = fs.realpathSync.native(path.resolve(__dirname, '../..'));
    const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(fixtureRoot, 'amw-extension-compile-')));
    const sketch = path.join(temporary, 'Blink');
    fs.mkdirSync(path.join(sketch, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(sketch, 'Blink.ino'), 'void setup() {}\nvoid loop() {}\n');
    const configurationPath = path.join(sketch, '.vscode', 'arduino.json');
    const configuration = JSON.stringify({ board: 'arduino:avr:uno', output: 'build', compile_profile: 'uno' });
    fs.writeFileSync(configurationPath, configuration);
    // Node treats the first Arduino argv element as this extensionless fixture script.
    fs.writeFileSync(path.join(sketch, 'compile'), compiler);
    t.after(() => {
        assert.equal(path.dirname(temporary), fixtureRoot);
        assert.ok(path.basename(temporary).startsWith('amw-extension-compile-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    });

    const statuses: { state: string; message: string }[] = [];
    const progress: OperationProgress[] = [];
    const displayed: string[] = [];
    const channel: string[] = [];
    const commands: string[][] = [];
    const calls: { executable: string; args: string[]; options: ProcessOptions }[] = [];
    const cancelListeners = new Set<() => void>();
    let cancellationRequested = false;
    let invalidations = 0;
    let saves = 0;
    let onViewText: ((text: string) => void) | undefined;
    let onPrepare: (() => void) | undefined;
    let discovery: ProcessResult = { exitCode: 0, signal: null, stdout: '{"boards":[]}', stderr: '', output: '', truncated: false, canceled: false, durationMs: 1 };
    const workspace = {
        isTrusted: true,
        textDocuments: [] as { isDirty: boolean; uri: { scheme: string; fsPath: string } }[],
        saveAll: async () => { saves++; return true; }
    };
    const outputChannel = { append: (text: string) => channel.push(text), appendLine: (text: string) => channel.push(text + '\n'), show() {} };
    const outputView = {
        prepare: async () => { onPrepare?.(); },
        setStatus: (state: string, message: string) => statuses.push({ state, message }),
        append: (text: string) => { displayed.push(text); onViewText?.(text); },
        appendInfo: (text: string) => displayed.push(text),
        showCommand: (_executable: string, args: string[]) => commands.push(args)
    };
    const compileStatusBarItem = { text: 'idle' };
    const extension: Record<string, unknown> = {
        arduinoExtensionChannel: outputChannel,
        compileOutputView: outputView, compileStatusBarItem,
        compileStatusBarExecuting: 'compiling', compileStatusBarNotExecuting: 'idle',
        updateStateCompileUpload: () => { invalidations++; },
        arduinoProject: {
            getProjectPath: () => sketch, getBoard: () => 'arduino:avr:uno', getBoardConfiguration: () => '',
            getProgrammer: () => '', optimizeForDebug: () => false
        },
        arduinoYaml: { status: () => 'inactive', getProfileName: () => 'uno' }
    };
    class CLIArguments { getBuildPath() { return path.join(sketch, 'selected-ui-build'); } }
    const dependencies: Record<string, unknown> = {
        vscode: {
            workspace, ProgressLocation: { Notification: 15 },
            window: {
                createOutputChannel: () => outputChannel,
                withProgress: async (_options: unknown, work: (progress: unknown, token: unknown) => Promise<unknown>) => work({}, {
                    get isCancellationRequested() { return cancellationRequested; },
                    onCancellationRequested: (listener: () => void) => {
                        cancelListeners.add(listener);
                        return { dispose: () => cancelListeners.delete(listener) };
                    }
                })
            }
        },
        './extension': extension,
        './shared/messages': { PROFILES_STATUS: { ACTIVE: 'active' } },
        '@microsoft/vscode-serial-monitor-api': { getSerialMonitorApi: async () => undefined, Version: { latest: 1 } },
        './ArduinoProject': { COMPILE_RESULT_FILE: 'compile_result.json', VSCODE_FOLDER: '.vscode' },
        './cliArgs': { CLIArguments }, './config': { ArduinoConfiguration: class {} },
        './cliCache': { CliCache: class {} }, './debugConfiguration': {},
        './ai/contracts': { AiBridgeError }, './ai/redaction': redaction,
        './ai/processRunner': {
            runProcess: (executable: string, args: string[], options: ProcessOptions) => {
                calls.push({ executable, args: [...args], options });
                return args[0] === 'board' ? Promise.resolve(discovery) : runProcess(executable, args, options);
            }
        }
    };
    const module = { exports: {} as Record<string, unknown> };
    loadCli((id) => {
        if (Object.hasOwn(dependencies, id)) { return dependencies[id]; }
        if (id.startsWith('node:') || ['fs', 'path', 'os'].includes(id)) { return require(id); }
        throw new Error(`Unexpected host dependency: ${id}`);
    }, module, module.exports);
    const ArduinoCLI = module.exports.ArduinoCLI as new (context: unknown) => TestedCli;
    const cli = new ArduinoCLI({ globalStorageUri: { fsPath: path.join(temporary, 'storage') } });
    cli.arduinoCLIPath = process.execPath;
    extension.arduinoCLI = cli;
    const target = () => inspectProject({ sketchPath: sketch }, sketch);
    const compile = (signal = new AbortController().signal, selected = target()) => cli.compileForAssistant(selected, signal, (value) => progress.push(value));
    return {
        cli, sketch, configurationPath, configuration, workspace, statuses, progress, displayed, channel, commands, calls,
        compileStatusBarItem, target, compile,
        marker: (selected = target()) => JSON.parse(fs.readFileSync(path.join(selected.buildPath, 'compile_result.json'), 'utf8')) as { result: boolean; fingerprint: string },
        invalidations: () => invalidations, saves: () => saves,
        onViewText: (callback: (text: string) => void) => { onViewText = callback; },
        onPrepare: (callback: () => void) => { onPrepare = callback; },
        setDiscovery: (result: Partial<ProcessResult>) => { discovery = { ...discovery, ...result }; },
        cancelUi: () => { cancellationRequested = true; for (const listener of [...cancelListeners]) { listener(); } }
    };
}

test('actual extension compile returns structured success, visible progress and a target-scoped marker', async (t) => {
    const f = host(t);
    const result = await f.compile();
    assert.equal(result.status, 'success', JSON.stringify(result));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'compiled\n');
    assert.match(result.operationId, /^[0-9a-f-]{36}$/);
    assert.equal(f.calls[0].executable, process.execPath);
    assert.deepEqual(f.calls[0].args, f.target().compileArgs);
    assert.equal(f.marker().result, true);
    assert.equal(f.marker().fingerprint, f.target().fingerprint);
    assert.equal(f.statuses.at(-1)?.state, 'success');
    assert.ok(f.progress.length >= 2);
    assert.equal(f.compileStatusBarItem.text, 'idle');
    assert.equal(f.cli.compileOrUploadRunning, false);
    assert.equal(f.saves(), 0);
    assert.equal(f.invalidations(), 0, 'assistant completion must not invoke the legacy profile-persisting state renderer');
    assert.equal(fs.readFileSync(f.configurationPath, 'utf8'), f.configuration);
    assert.equal(fs.existsSync(path.join(f.sketch, '.vscode', 'c_cpp_properties.json')), false, 'different target must not update UI IntelliSense');
});

test('actual extension compile preserves compiler errors and marks failure', async (t) => {
    const f = host(t, 'process.stdout.write("building\\n"); process.stderr.write("Blink.ino:4: error: simulated failure\\n"); process.exitCode=3;');
    const result = await f.compile();
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 3);
    assert.equal(result.error?.code, 'CLI_FAILED');
    assert.match(result.stderr, /simulated failure/);
    assert.equal(f.marker().result, false);
    assert.equal(f.statuses.at(-1)?.state, 'failure');
    assert.equal(f.cli.compileOrUploadRunning, false);
});

test('actual extension compiles an explicit profile without persisting that selection', async (t) => {
    const f = host(t, 'process.stdout.write(JSON.stringify(process.argv.slice(2))+"\\n");');
    const yamlPath = path.join(f.sketch, 'sketch.yaml');
    const yaml = 'default_profile: uno\nprofiles:\n  uno:\n    fqbn: arduino:avr:uno\n  nano:\n    fqbn: arduino:avr:nano\n';
    fs.writeFileSync(yamlPath, yaml);
    const target = inspectProject({ sketchPath: f.sketch, profile: 'nano' }, f.sketch);
    const result = await f.compile(undefined, target);
    assert.equal(result.status, 'success');
    assert.deepEqual(JSON.parse(result.stdout), target.compileArgs.slice(1));
    assert.equal(target.resolvedProfile, 'nano');
    assert.equal(f.marker(target).result, true);
    assert.equal(fs.readFileSync(f.configurationPath, 'utf8'), f.configuration);
    assert.equal(fs.readFileSync(yamlPath, 'utf8'), yaml);
    assert.equal(fs.existsSync(path.join(f.sketch, '.vscode', 'c_cpp_properties.json')), false);
});

test('actual extension compile coordinates busy state and request cancellation', { timeout: 10000 }, async (t) => {
    const f = host(t, 'process.stdout.write("compiler ready\\n"); setInterval(()=>{},1000);');
    const controller = new AbortController();
    t.after(() => controller.abort());
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    f.onViewText((text) => { if (text.includes('compiler ready')) { ready(); } });
    const pending = f.compile(controller.signal);
    await started;
    const busy = await f.compile();
    assert.equal(busy.status, 'busy');
    assert.equal(busy.error?.code, 'BUSY');
    assert.equal(f.calls.length, 1);
    controller.abort();
    const canceled = await pending;
    assert.equal(canceled.status, 'canceled');
    assert.equal(canceled.error?.code, 'CANCELED');
    assert.equal(f.marker().result, false);
    assert.equal(f.statuses.at(-1)?.state, 'canceled');
    assert.equal(f.cli.compileOrUploadRunning, false);
});

test('actual extension compile accepts cancellation from its visible VS Code progress control', { timeout: 10000 }, async (t) => {
    const f = host(t, 'process.stdout.write("compiler ready\\n"); setInterval(()=>{},1000);');
    const controller = new AbortController();
    t.after(() => controller.abort());
    f.onViewText((text) => { if (text.includes('compiler ready')) { f.cancelUi(); } });
    const result = await f.compile(controller.signal);
    assert.equal(result.status, 'canceled');
    assert.equal(f.marker().result, false);
    assert.equal(f.compileStatusBarItem.text, 'idle');
});

test('actual extension rejects trust, dirty documents, forbidden argv and pre-abort before spawning', async (t) => {
    const f = host(t);
    f.workspace.isTrusted = false;
    assert.equal((await f.compile()).error?.code, 'WORKSPACE_UNTRUSTED');
    f.workspace.isTrusted = true;
    f.workspace.textDocuments.push({ isDirty: true, uri: { scheme: 'file', fsPath: path.join(f.sketch, 'Blink.ino') } });
    assert.equal((await f.compile()).error?.code, 'UNSAVED_DOCUMENTS');
    f.workspace.textDocuments = [];
    const target = f.target();
    target.compileArgs.splice(1, 0, '--upload');
    assert.equal((await f.compile(undefined, target)).error?.code, 'INVALID_TARGET');
    const controller = new AbortController(); controller.abort();
    assert.equal((await f.compile(controller.signal)).status, 'canceled');
    assert.equal(f.calls.length, 0);
    assert.equal(fs.existsSync(f.target().buildPath), false);
    assert.equal(f.saves(), 0);
});

test('actual extension rechecks trust after asynchronous output setup', async (t) => {
    const f = host(t);
    f.onPrepare(() => { f.workspace.isTrusted = false; });
    const result = await f.compile();
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'WORKSPACE_UNTRUSTED');
    assert.equal(f.calls.length, 0);
    assert.equal(f.marker().result, false);
});

test('actual extension bounds displayed output and retained results before stale-input invalidation', async (t) => {
    const f = host(t, 'process.stdout.write(("x".repeat(200)+"\\n").repeat(1200)); process.stderr.write("password=dummy-value\\n");');
    const result = await f.compile();
    assert.equal(result.status, 'success');
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 64 * 1024);
    assert.ok(Buffer.byteLength(result.stderr) <= 64 * 1024);
    assert.ok(Buffer.byteLength(f.displayed.join('')) < 129 * 1024);
    assert.ok(!f.displayed.join('').includes('dummy-value'));
    assert.match(result.stderr, /password=<redacted>/);
    f.cli.invalidateAssistantBuild(result.target);
    assert.equal(f.marker().result, false);
    assert.equal(f.statuses.at(-1)?.state, 'failure');
    assert.match(f.displayed.at(-1) ?? '', /Inputs changed.*Compile again/);
});

test('actual extension discovery uses fixed JSON argv and parses stdout independently of stderr', async (t) => {
    const f = host(t);
    f.setDiscovery({ stdout: '{"boards":[{"fqbn":"arduino:avr:uno"}]}', stderr: 'a harmless warning' });
    assert.deepEqual(await f.cli.discoverForAssistant('boards', new AbortController().signal), { boards: [{ fqbn: 'arduino:avr:uno' }] });
    f.setDiscovery({ stdout: '{"detected_ports":[]}' });
    assert.deepEqual(await f.cli.discoverForAssistant('ports', new AbortController().signal), { detected_ports: [] });
    assert.deepEqual(f.calls.map((call) => call.args), [['board', 'listall', '--json'], ['board', 'list', '--json']]);
    assert.equal(f.statuses.length, 0);
    assert.equal(fs.existsSync(f.target().buildPath), false);
});

test('actual extension discovery redacts failure messages and rejects invalid JSON, truncation and cancellation', async (t) => {
    const f = host(t);
    const rejected = (expected: string) => (error: unknown) => error instanceof AiBridgeError && error.code === expected && !error.message.includes('dummy-value');
    f.setDiscovery({ exitCode: 4, stderr: 'password=dummy-value\n' });
    await assert.rejects(f.cli.discoverForAssistant('ports', new AbortController().signal), rejected('CLI_FAILED'));
    f.setDiscovery({ exitCode: 0, stdout: '{invalid}', stderr: '' });
    await assert.rejects(f.cli.discoverForAssistant('ports', new AbortController().signal), rejected('INVALID_CLI_OUTPUT'));
    f.setDiscovery({ truncated: true });
    await assert.rejects(f.cli.discoverForAssistant('ports', new AbortController().signal), rejected('OUTPUT_LIMIT'));
    f.setDiscovery({ truncated: false, canceled: true });
    await assert.rejects(f.cli.discoverForAssistant('ports', new AbortController().signal), rejected('CANCELED'));
    const calls = f.calls.length;
    f.workspace.isTrusted = false;
    await assert.rejects(f.cli.discoverForAssistant('ports', new AbortController().signal), rejected('WORKSPACE_UNTRUSTED'));
    assert.equal(f.calls.length, calls);
});
