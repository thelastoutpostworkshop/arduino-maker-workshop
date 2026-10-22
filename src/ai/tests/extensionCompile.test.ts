import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test, type TestContext } from 'node:test';
import * as ts from 'typescript';
import { AiBridgeError, type AiDiscoveryQuery, type AiOperationResult, type OperationProgress, type ProjectInspection } from '../contracts';
import { inspectProject } from '../projectInspection';
import { runProcess, type ProcessOptions, type ProcessResult } from '../processRunner';
import * as redaction from '../redaction';
import * as compileOutput from '../compileOutput';
import * as compileArtifacts from '../compileArtifacts';
import * as backtrace from '../backtrace';
import * as libraryInstallation from '../libraryInstallation';

interface TestedCli {
    arduinoCLIPath: string;
    compileOrUploadRunning: boolean;
    getCLIStatus(): { VersionString: string };
    compileForAssistant(target: ProjectInspection, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<AiOperationResult>;
    decodeBacktraceForAssistant(target: ProjectInspection, log: string, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<backtrace.BacktraceDecodeResult>;
    discoverForAssistant(kind: 'boards' | 'ports' | 'cores' | 'libraries', signal: AbortSignal): Promise<unknown>;
    queryForAssistant(query: AiDiscoveryQuery, signal: AbortSignal): Promise<unknown>;
    invalidateAssistantBuild(target: ProjectInspection): void;
    installLibraryForAssistant(target: ProjectInspection, library: string, version: string, signal: AbortSignal,
        progress: (value: OperationProgress) => void, assertCurrent: () => void, onInventory: (value: unknown, outdated?: unknown) => void): Promise<libraryInstallation.LibraryInstallationResult>;
    runArduinoCommand(args: () => string[], prefix: string, cache: { caching: number; ttl: number }): Promise<string>;
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
    const cacheDeletes: string[] = [];
    const inventories: unknown[] = [];
    const outdatedInventories: unknown[] = [];
    const cancelListeners = new Set<() => void>();
    let cancellationRequested = false;
    let verboseCompile: boolean | undefined;
    let invalidations = 0;
    let saves = 0;
    let onViewText: ((text: string) => void) | undefined;
    let onPrepare: (() => void) | undefined;
    let onDiscovery: (() => void) | undefined;
    let onDecode = backtrace.decodeEsp32Backtrace;
    let processHandler: ((args: string[], options: ProcessOptions) => Promise<ProcessResult>) | undefined;
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
    class CLIArguments {
        getBuildPath() { return path.join(sketch, 'selected-ui-build'); }
        getVerboseOption() { return verboseCompile ?? true; }
        getLibraryInstalledArguments() { return ['lib', 'list', '--json']; }
        getLibrarySearchArguments() { return ['lib', 'search', '--omit-releases-details', '--json']; }
    }
    const dependencies: Record<string, unknown> = {
        vscode: {
            workspace, ProgressLocation: { Notification: 15 },
            window: {
                createOutputChannel: () => outputChannel,
                showErrorMessage: () => undefined,
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
        './cliCache': { CliCache: class {
            getCacheKeyFromArguments(args: string[]) { return args.slice(0, 2).join(''); }
            delete(key: string) { cacheDeletes.push(key); }
        } }, './debugConfiguration': {},
        './ai/contracts': { AiBridgeError }, './ai/redaction': redaction,
        './ai/compileOutput': compileOutput, './ai/compileArtifacts': compileArtifacts,
        './ai/backtrace': { ...backtrace, decodeEsp32Backtrace: (options: Parameters<typeof backtrace.decodeEsp32Backtrace>[0]) => onDecode(options) },
        './ai/libraryInstallation': libraryInstallation,
        './ai/processRunner': {
            runProcess: (executable: string, args: string[], options: ProcessOptions) => {
                calls.push({ executable, args: [...args], options });
                if (['board', 'core', 'lib', 'config', 'outdated'].includes(args[0])) {
                    onDiscovery?.();
                    if (processHandler) { return processHandler(args, options); }
                    return Promise.resolve(discovery);
                }
                return runProcess(executable, args, options);
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
    cli.getCLIStatus().VersionString = '1.5.1';
    extension.arduinoCLI = cli;
    const target = () => inspectProject({ sketchPath: sketch }, sketch);
    const compile = (signal = new AbortController().signal, selected = target()) => cli.compileForAssistant(selected, signal, (value) => progress.push(value));
    return {
        cli, sketch, configurationPath, configuration, workspace, statuses, progress, displayed, channel, commands, calls, cacheDeletes, inventories, outdatedInventories,
        compileStatusBarItem, target, compile,
        install: (library = 'ArduinoJson', version = '7.3.0', signal = new AbortController().signal, guard = () => {}) =>
            cli.installLibraryForAssistant(target(), library, version, signal, value => progress.push(value), guard, (value, outdated) => { inventories.push(value); outdatedInventories.push(outdated); }),
        marker: (selected = target()) => JSON.parse(fs.readFileSync(path.join(selected.buildPath, 'compile_result.json'), 'utf8')) as { result: boolean; fingerprint: string },
        invalidations: () => invalidations, saves: () => saves,
        onViewText: (callback: (text: string) => void) => { onViewText = callback; },
        onPrepare: (callback: () => void) => { onPrepare = callback; },
        setVerboseCompile: (value: boolean | undefined) => { verboseCompile = value; },
        setDiscovery: (result: Partial<ProcessResult>) => { discovery = { ...discovery, ...result }; },
        onDiscovery: (callback: () => void) => { onDiscovery = callback; },
        onDecode: (callback: typeof backtrace.decodeEsp32Backtrace) => { onDecode = callback; },
        onProcess: (callback: (args: string[], options: ProcessOptions) => Promise<ProcessResult>) => { processHandler = callback; },
        cancelUi: () => { cancellationRequested = true; for (const listener of [...cancelListeners]) { listener(); } }
    };
}

const installedUserLibrary = (name = 'ArduinoJson', version = '7.3.0') => ({ library: { name, version, location: 'user' } });
const libraryProcessResult = (value: unknown, overrides: Partial<ProcessResult> = {}): ProcessResult => ({
    exitCode: 0, signal: null, stdout: JSON.stringify(value), stderr: '', output: '',
    truncated: false, canceled: false, durationMs: 1, ...overrides,
});
const indexedLibrary = { status: 'success', libraries: [{ name: 'ArduinoJson', available_versions: ['7.3.0'], latest: { version: '7.3.0' } }] };

test('assistant library installation uses fixed argv, refreshes inventory and invalidates the ordinary build', async t => {
    const f = host(t);
    await f.compile();
    f.calls.length = 0;
    let installed = false;
    f.onProcess(async (args, options) => {
        if (args[0] === 'outdated') { return libraryProcessResult({ libraries: [], platforms: [] }); }
        if (args[1] === 'search') { return libraryProcessResult(indexedLibrary); }
        if (args[1] === 'install') {
            assert.deepEqual(args, ['lib', 'install', '--', 'ArduinoJson@7.3.0']);
            assert.equal(options.cwd, f.sketch);
            assert.equal(options.maxOutputBytes, 64 * 1024);
            installed = true;
            options.onStdout?.('Downloaded ArduinoJson\n');
            return libraryProcessResult(null, { stdout: 'Library installed\n' });
        }
        assert.deepEqual(args, ['lib', 'list', '--all', '--json']);
        return libraryProcessResult({ installed_libraries: installed ? [installedUserLibrary(), { library: { name: 'SPI', version: '1.0.0', location: 'platform' } }] : [] });
    });
    const result = await f.install();
    assert.equal(result.status, 'success', JSON.stringify(result));
    assert.equal(result.scope, 'user_libraries');
    assert.deepEqual(result.installedVersions, ['7.3.0']);
    assert.deepEqual(f.calls.map(call => call.args[1]), ['list', 'search', 'install', 'list', '--json']);
    assert.equal(f.marker().result, false);
    assert.deepEqual(f.cacheDeletes, ['liblist', 'libsearch', 'liblist', 'libsearch']);
    assert.equal(f.inventories[0], undefined);
    assert.deepEqual(f.inventories.at(-1), { installed_libraries: [installedUserLibrary()] });
    assert.deepEqual(f.outdatedInventories.at(-1), { libraries: [], platforms: [] });
    assert.ok(f.displayed.join('').includes('Downloaded ArduinoJson'));
    assert.ok(f.progress.some(value => value.message.includes('Downloaded ArduinoJson')));
    assert.equal(f.cli.compileOrUploadRunning, false);
    assert.equal(f.saves(), 0);
    assert.equal(fs.readFileSync(f.configurationPath, 'utf8'), f.configuration);
});

test('already-installed user library leaves build readiness and caches unchanged', async t => {
    const f = host(t);
    await f.compile();
    f.calls.length = 0;
    const marker = fs.readFileSync(path.join(f.target().buildPath, 'compile_result.json'), 'utf8');
    f.onProcess(async args => {
        assert.equal(args[1], 'list');
        return libraryProcessResult({ installed_libraries: [installedUserLibrary()] });
    });
    const result = await f.install();
    assert.equal(result.outcome, 'already_installed');
    assert.equal(result.changesMayHaveOccurred, false);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.cacheDeletes, []);
    assert.equal(fs.readFileSync(path.join(f.target().buildPath, 'compile_result.json'), 'utf8'), marker);
    assert.equal(f.cli.compileOrUploadRunning, false);
});

test('failed installation retains observed partial changes and clears caches', async t => {
    const f = host(t);
    let attempted = false;
    f.onProcess(async args => {
        if (args[1] === 'search') { return libraryProcessResult(indexedLibrary); }
        if (args[1] === 'install') {
            attempted = true;
            return libraryProcessResult(null, { exitCode: 1, stderr: 'Download failed\n', stdout: '' });
        }
        return libraryProcessResult({ installed_libraries: attempted ? [installedUserLibrary('Dependency', '1.0.0')] : [] });
    });
    const result = await f.install();
    assert.equal(result.status, 'failed');
    assert.equal(result.changesMayHaveOccurred, true);
    assert.deepEqual(result.changes.added, [{ name: 'Dependency', version: '1.0.0' }]);
    assert.equal(f.marker().result, false);
    assert.equal(f.cacheDeletes.length, 4);
    assert.equal(f.statuses.at(-1)?.state, 'failure');
    assert.equal(f.cli.compileOrUploadRunning, false);
});

test('UI cancellation interrupts install, blocks concurrent operations and does not start a verification process', async t => {
    const f = host(t);
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    f.onProcess(async (args, options) => {
        if (args[1] === 'search') { return libraryProcessResult(indexedLibrary); }
        if (args[1] === 'install') {
            started();
            await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
            return libraryProcessResult(null, { exitCode: null, stdout: '', canceled: true });
        }
        return libraryProcessResult({ installed_libraries: [] });
    });
    const installing = f.install();
    await entered;
    assert.equal((await f.compile()).status, 'busy');
    await assert.rejects(f.install(), { code: 'BUSY' });
    await assert.rejects(f.cli.runArduinoCommand(() => ['lib', 'uninstall', 'ArduinoJson'], 'Remove failed', { caching: 1, ttl: 0 }), { code: 'BUSY' });
    await assert.rejects(f.cli.runArduinoCommand(() => ['config', 'set', 'directories.user', 'elsewhere'], 'Config failed', { caching: 1, ttl: 0 }), { code: 'BUSY' });
    f.cancelUi();
    const result = await installing;
    assert.equal(result.status, 'canceled');
    assert.equal(result.installedVersions, null);
    assert.equal(result.changesMayHaveOccurred, true);
    assert.deepEqual(f.calls.map(call => call.args[1]), ['list', 'search', 'install']);
    assert.deepEqual(f.inventories, [undefined]);
    assert.equal(f.cacheDeletes.length, 4);
    assert.equal(f.cli.compileOrUploadRunning, false);
});

test('existing manual package operations prevent assistant installation until completion', async t => {
    const f = host(t);
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    f.onProcess(async () => { await pending; return libraryProcessResult(null, { output: 'installed' }); });
    const manual = f.cli.runArduinoCommand(() => ['lib', 'install', 'Other@1.0.0'], 'Install failed', { caching: 1, ttl: 0 });
    await assert.rejects(f.install(), { code: 'BUSY' });
    finish();
    await manual;
    f.onProcess(async () => libraryProcessResult({ installed_libraries: [installedUserLibrary()] }));
    assert.equal((await f.install()).outcome, 'already_installed');
});

test('library installation rechecks cancellation and trust after asynchronous output setup', async t => {
    for (const cancel of [false, true]) {
        const f = host(t);
        f.onProcess(async args => libraryProcessResult(args[1] === 'search' ? indexedLibrary : { installed_libraries: [] }));
        f.onPrepare(() => { if (cancel) { f.cancelUi(); } else { f.workspace.isTrusted = false; } });
        const result = await f.install();
        assert.equal(result.status, cancel ? 'canceled' : 'failed');
        assert.equal(result.error?.code, cancel ? 'CANCELED' : 'WORKSPACE_UNTRUSTED');
        assert.ok(!f.calls.some(call => call.args[1] === 'install'));
        assert.equal(f.cli.compileOrUploadRunning, false);
    }
});

test('actual extension compile returns structured success, visible progress and a target-scoped marker', async (t) => {
    const f = host(t);
    const result = await f.compile();
    assert.equal(result.status, 'success', JSON.stringify(result));
    assert.equal(result.exitCode, 0);
    assert.equal(result.cliVersion, '1.5.1');
    assert.equal(result.stdout, 'compiled\n');
    assert.equal(result.diagnostics.status, 'unavailable');
    assert.equal(result.memory.status, 'unavailable');
    assert.equal(result.artifacts.status, 'unavailable');
    assert.equal(result.dependencies.status, 'unavailable');
    assert.match(result.operationId, /^[0-9a-f-]{36}$/);
    assert.equal(f.calls[0].executable, process.execPath);
    assert.deepEqual(f.calls[0].args, result.target.compileArgs);
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

test('actual extension compile follows the verbose preference for every request without changing the inspected plan', async (t) => {
    const f = host(t, 'process.stdout.write(JSON.stringify(process.argv.slice(2))+"\\n");');
    const target = f.target();
    const inspectedArgs = [...target.compileArgs];
    const fingerprint = target.fingerprint;
    for (const setting of [undefined, false, true, false]) {
        f.setVerboseCompile(setting);
        const result = await f.compile(undefined, target);
        assert.equal(result.status, 'success', JSON.stringify(result));
        const expectedArgs = [...inspectedArgs];
        if (setting !== false) { expectedArgs.splice(1, 0, '-v'); }
        assert.deepEqual(f.calls.at(-1)?.args, expectedArgs);
        assert.deepEqual(f.commands.at(-1), expectedArgs);
        assert.deepEqual(result.target.compileArgs, expectedArgs);
        assert.deepEqual(JSON.parse(result.stdout), expectedArgs.slice(1));
        assert.equal(result.target.fingerprint, fingerprint);
        assert.deepEqual(target.compileArgs, inspectedArgs, 'execution options must not mutate the inspected plan');
        assert.equal(target.fingerprint, fingerprint);
    }
});

test('actual extension reports warning locations, memory and only newly produced profile artifacts', async (t) => {
    const compiler = `
        const fs = require('node:fs'), path = require('node:path');
        const output = process.argv[process.argv.indexOf('--build-path') + 1];
        const firmware = path.join(output, 'Blink.ino.bin');
        if (!fs.existsSync(firmware)) fs.writeFileSync(firmware, 'firmware');
        console.error('Blink.ino:8:3: warning: unused variable [-Wunused-variable]');
        console.log('Sketch uses 1000 bytes (10%) of program storage space. Maximum is 10000 bytes.');
        console.log('Global variables use 100 bytes (5%) of dynamic memory, leaving 1900 bytes for local variables. Maximum is 2000 bytes.');
        console.log('');
        console.log('Used library'.padEnd(20) + 'Version'.padEnd(10) + 'Path');
        console.log('Sensor Library'.padEnd(20) + '2.1.0'.padEnd(10) + path.join(process.cwd(), 'profile cache', 'SensorLibrary'));
        console.log('');
        console.log('Used platform'.padEnd(20) + 'Version'.padEnd(10) + 'Path');
        console.log('arduino:avr'.padEnd(20) + '1.8.6'.padEnd(10) + path.join(process.cwd(), 'profile cache', 'arduino', 'hardware', 'avr', '1.8.6'));
    `;
    const f = host(t, compiler);
    fs.writeFileSync(path.join(f.sketch, 'sketch.yaml'), 'profiles:\n  nano:\n    fqbn: arduino:avr:nano\n');
    const target = inspectProject({ sketchPath: f.sketch, profile: 'nano' }, f.sketch);
    fs.mkdirSync(target.buildPath, { recursive: true });
    fs.writeFileSync(path.join(target.buildPath, 'Blink.ino.elf'), 'old cached elf');
    const result = await f.compile(undefined, target);
    assert.equal(result.status, 'success');
    assert.equal(result.diagnostics.status, 'available');
    assert.deepEqual(result.diagnostics.items, [{ severity: 'warning', message: 'unused variable',
        file: path.join(f.sketch, 'Blink.ino'), line: 8, column: 3, code: '-Wunused-variable' }]);
    assert.equal(result.memory.status, 'available');
    assert.deepEqual(result.memory.flash, { usedBytes: 1000, percent: 10, maxBytes: 10000 });
    assert.deepEqual(result.memory.ram, { usedBytes: 100, percent: 5, maxBytes: 2000 });
    assert.equal(result.dependencies.status, 'available');
    assert.deepEqual(result.dependencies.libraries, [{ name: 'Sensor Library', version: '2.1.0',
        path: path.join(f.sketch, 'profile cache', 'SensorLibrary') }]);
    assert.deepEqual(result.dependencies.platforms, [{ id: 'arduino:avr', version: '1.8.6',
        path: path.join(f.sketch, 'profile cache', 'arduino', 'hardware', 'avr', '1.8.6') }]);
    assert.deepEqual(result.artifacts.files, [{ path: path.join(target.buildPath, 'Blink.ino.bin'),
        relativePath: 'Blink.ino.bin', kind: 'bin', sizeBytes: 8 }]);
    assert.match(result.artifacts.notes.join(' '), /cached/);
    assert.match(result.stdout, /Sketch uses/);
    assert.match(result.stderr, /unused variable/);
    assert.match(f.displayed.join(''), /Sketch uses/);
    assert.equal((await f.compile(undefined, target)).artifacts.status, 'unavailable', 'unchanged outputs must not be reported as freshly built');
    assert.equal(f.calls.length, 2, 'structured reports must not launch extra compiler or size commands');
    assert.ok(f.calls.every(call => !call.args.includes('--json')), 'compiler output must remain live');
});

test('actual extension reports unavailable build dependencies when nonverbose output omits them', async (t) => {
    const f = host(t);
    f.setVerboseCompile(false);
    f.cli.getCLIStatus().VersionString = '';
    const result = await f.compile();
    assert.equal(result.status, 'success');
    assert.equal(result.cliVersion, null, 'unknown CLI version must not be guessed');
    assert.equal(result.dependencies.status, 'unavailable');
    assert.deepEqual(result.dependencies.libraries, []);
    assert.deepEqual(result.dependencies.platforms, []);
    assert.equal(f.calls.length, 1, 'no inventory query may substitute installed packages for build dependencies');
    assert.ok(!f.calls[0].args.includes('-v'), 'dependency reporting must respect the verbose preference');
});

test('actual AI compilation records a matching ESP32 ELF and clears that record on invalidation', async (t) => {
    const f = host(t, `
        const fs = require('node:fs'), path = require('node:path');
        const output = process.argv[process.argv.indexOf('--build-path') + 1];
        const elf = Buffer.alloc(64);
        elf.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]);
        elf.writeUInt16LE(2, 16); elf.writeUInt16LE(94, 18);
        elf.writeUInt32LE(1, 20); elf.writeUInt16LE(52, 40);
        fs.writeFileSync(path.join(output, 'Blink.ino.elf'), elf);
        console.log('compiled');
    `);
    fs.writeFileSync(f.configurationPath, JSON.stringify({ board: 'esp32:esp32:esp32', output: 'build' }));
    const target = inspectProject({ sketchPath: f.sketch, clean: true }, f.sketch);
    const result = await f.compile(undefined, target);
    assert.equal(result.status, 'success');
    const marker = JSON.parse(fs.readFileSync(path.join(target.buildPath, 'compile_result.json'), 'utf8'));
    assert.ok(marker.backtrace, 'successful AI builds must persist ELF provenance for later decoding');
    assert.match(JSON.stringify(marker.backtrace), /[a-f0-9]{64}/);
    assert.equal(target.buildFingerprint, f.target().buildFingerprint, 'clean builds must match ordinary decode requests');
    f.cli.invalidateAssistantBuild(target);
    const invalid = JSON.parse(fs.readFileSync(path.join(target.buildPath, 'compile_result.json'), 'utf8'));
    assert.equal(invalid.result, false);
    assert.equal(invalid.backtrace, undefined);
});

test('actual extension decode uses fixed configuration lookup, shares the Arduino lock and cancels from VS Code', async (t) => {
    const f = host(t);
    fs.writeFileSync(f.configurationPath, JSON.stringify({ board: 'esp32:esp32:esp32', output: 'build' }));
    const dataDir = path.join(f.sketch, 'Arduino Data');
    f.setDiscovery({ stdout: JSON.stringify({ config: { directories: { data: dataDir } } }) });
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    f.onDecode(async options => {
        assert.equal(options.dataDir, dataDir);
        assert.equal(options.log, 'PC: 0x40001234');
        assert.equal(options.target.fqbn, 'esp32:esp32:esp32');
        started();
        await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new AiBridgeError('CANCELED', 'Decoded request canceled.');
    });
    const controller = new AbortController();
    t.after(() => controller.abort());
    const pending = f.cli.decodeBacktraceForAssistant(f.target(), 'PC: 0x40001234', controller.signal, () => {});
    await ready;
    assert.equal((await f.compile()).status, 'busy');
    await assert.rejects(f.cli.decodeBacktraceForAssistant(f.target(), 'PC: 0x40001234', controller.signal, () => {}), { code: 'BUSY' });
    assert.deepEqual(f.calls.map(call => call.args), [['config', 'dump', '--json']]);
    f.cancelUi();
    await assert.rejects(pending, { code: 'CANCELED' });
    assert.equal(f.cli.compileOrUploadRunning, false);
    assert.equal(f.saves(), 0);
    assert.equal(fs.existsSync(f.target().buildPath), false, 'decoding must not compile or create build output');
});

test('actual extension decoding rejects invalid CLI data and trust revocation without invoking the decoder', async (t) => {
    const f = host(t);
    f.onDecode(async () => { assert.fail('Decoder must not start.'); });
    const decode = () => f.cli.decodeBacktraceForAssistant(f.target(), 'PC: 0x40001234', new AbortController().signal, () => {});
    f.workspace.isTrusted = false;
    await assert.rejects(decode(), { code: 'WORKSPACE_UNTRUSTED' });
    assert.equal(f.calls.length, 0);
    f.workspace.isTrusted = true;
    f.setDiscovery({ stdout: '{"config":{"directories":{"data":"relative"}}}' });
    await assert.rejects(decode(), { code: 'INVALID_CLI_CONFIG' });
    assert.equal(f.cli.compileOrUploadRunning, false);
    f.setDiscovery({ stdout: JSON.stringify({ directories: { data: f.sketch } }) });
    f.onDiscovery(() => { f.workspace.isTrusted = false; });
    await assert.rejects(decode(), { code: 'WORKSPACE_UNTRUSTED' });
    assert.equal(f.cli.compileOrUploadRunning, false);
});

test('actual extension retains early redacted diagnostics after verbose log truncation', async (t) => {
    const f = host(t, `
        console.log('Blink.ino:2:9: warning: password=dummy-value');
        console.log('Using library Sensor Library at version 2.1.0 in folder: /libraries/password=dummy-value');
        process.stdout.write(('verbose line '.repeat(20) + '\\n').repeat(1200));
        console.log("Le croquis utilise 291184 octets (9%) de l'espace de stockage de programmes. Le maximum est de 3145728 octets.");
        console.log('Les variables globales utilisent 29824 octets (9%) de m\\u00e9moire dynamique, ce qui laisse 297856 octets pour les variables locales. Le maximum est de 327680 octets.');
    `);
    const result = await f.compile();
    assert.equal(result.status, 'success');
    assert.equal(result.truncated, true);
    assert.doesNotMatch(result.stdout, /Blink.ino:2/);
    assert.equal(result.diagnostics.status, 'partial');
    assert.equal(result.diagnostics.items[0].line, 2);
    assert.match(result.diagnostics.items[0].message, /password=<redacted>/);
    assert.doesNotMatch(JSON.stringify(result), /dummy-value/);
    assert.equal(result.memory.flash?.usedBytes, 291184);
    assert.equal(result.memory.ram?.usedBytes, 29824);
    assert.equal(result.memory.status, 'partial');
    assert.equal(result.dependencies.status, 'partial');
    assert.equal(result.dependencies.libraries[0].version, '2.1.0');
    assert.match(result.dependencies.libraries[0].path ?? '', /<redacted>/);
});

test('actual extension reports fresh artifacts when a clean compile recreates its output directory', async (t) => {
    const f = host(t, `
        const fs = require('node:fs'), path = require('node:path');
        const output = process.argv[process.argv.indexOf('--build-path') + 1];
        if (!path.resolve(output).startsWith(path.resolve(process.cwd()) + path.sep)) throw new Error('Fixture output escaped sketch');
        fs.rmSync(output, { recursive: true, force: true });
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'Blink.ino.elf'), 'new clean build');
        console.log('compiled');
    `);
    const target = inspectProject({ sketchPath: f.sketch, clean: true }, f.sketch);
    fs.mkdirSync(target.buildPath, { recursive: true });
    fs.writeFileSync(path.join(target.buildPath, 'Blink.ino.elf'), 'old output');
    const result = await f.compile(undefined, target);
    assert.equal(result.status, 'success');
    assert.equal(result.artifacts.status, 'available');
    assert.equal(result.artifacts.files[0].sizeBytes, 15);
    assert.equal(result.artifacts.files[0].path, path.join(target.buildPath, 'Blink.ino.elf'));
    assert.equal(f.marker(target).result, true);
});

test('actual extension withholds artifact files from failed and canceled processes', async (t) => {
    for (const mode of ['failed', 'canceled']) {
        const f = host(t, `
            const path = require('node:path');
            const output = process.argv[process.argv.indexOf('--build-path') + 1];
            require('node:fs').writeFileSync(path.join(output, 'Blink.ino.bin'), 'unfinished');
            console.log('compiler ready');
            ${mode === 'failed' ? 'process.exitCode = 1;' : 'setInterval(()=>{},1000);'}
        `);
        const controller = new AbortController();
        t.after(() => controller.abort());
        if (mode === 'canceled') { f.onViewText(text => { if (text.includes('compiler ready')) { controller.abort(); } }); }
        const result = await f.compile(controller.signal);
        assert.equal(result.status, mode);
        assert.equal(result.artifacts.status, 'unavailable');
        assert.deepEqual(result.artifacts.files, []);
        assert.equal(f.marker().result, false);
    }
});

test('actual extension compile preserves compiler errors and marks failure', async (t) => {
    const f = host(t, 'process.stdout.write("building\\n"); process.stderr.write("Blink.ino:4: error: simulated failure\\n"); process.exitCode=3;');
    const result = await f.compile();
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 3);
    assert.equal(result.error?.code, 'CLI_FAILED');
    assert.match(result.stderr, /simulated failure/);
    assert.equal(result.diagnostics.items[0].severity, 'error');
    assert.equal(result.diagnostics.items[0].line, 4);
    assert.equal(result.diagnostics.items[0].file, path.join(f.sketch, 'Blink.ino'));
    assert.deepEqual(result.artifacts.files, []);
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
    assert.deepEqual(JSON.parse(result.stdout), result.target.compileArgs.slice(1));
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
    assert.equal(busy.diagnostics.status, 'unavailable');
    assert.equal(busy.memory.status, 'unavailable');
    assert.equal(busy.dependencies.status, 'unavailable');
    assert.equal(busy.artifacts.status, 'unavailable');
    assert.equal(f.calls.length, 1);
    controller.abort();
    const canceled = await pending;
    assert.equal(canceled.status, 'canceled');
    assert.equal(canceled.error?.code, 'CANCELED');
    assert.deepEqual(canceled.artifacts.files, []);
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

test('actual extension discovery uses fixed JSON argv and keeps stdout data separate from diagnostic warnings', async (t) => {
    const f = host(t);
    f.setDiscovery({ stdout: '{"boards":[{"fqbn":"arduino:avr:uno"}]}', stderr: 'a harmless warning' });
    const boards = await f.cli.discoverForAssistant('boards', new AbortController().signal) as { boards: unknown[]; warnings: string[] };
    assert.deepEqual(boards.boards, [{ fqbn: 'arduino:avr:uno' }]);
    assert.equal(boards.warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(boards), /a harmless warning/);
    f.setDiscovery({ stdout: '{"detected_ports":[]}', stderr: '' });
    assert.deepEqual(await f.cli.discoverForAssistant('ports', new AbortController().signal), { detected_ports: [] });
    f.setDiscovery({ stdout: '{"platforms":[{"id":"arduino:avr","installed_version":"1.8.6"}]}' });
    assert.deepEqual(await f.cli.discoverForAssistant('cores', new AbortController().signal), { platforms: [{ id: 'arduino:avr', installed_version: '1.8.6' }] });
    f.setDiscovery({ stdout: '{"installed_libraries":[]}' });
    assert.deepEqual(await f.cli.discoverForAssistant('libraries', new AbortController().signal), { installed_libraries: [] });
    assert.deepEqual(f.calls.map((call) => call.args), [
        ['board', 'listall', '--json'], ['board', 'list', '--json'],
        ['core', 'list', '--json'], ['lib', 'list', '--all', '--json']
    ]);
    assert.ok(f.calls.every(call => call.options.maxOutputBytes === 512 * 1024));
    assert.equal(f.statuses.length, 0);
    assert.equal(fs.existsSync(f.target().buildPath), false);
});

test('actual extension discovery redacts failure messages and rejects invalid JSON, truncation and cancellation', async (t) => {
    const f = host(t);
    const rejected = (expected: string) => (error: unknown) => error instanceof AiBridgeError && error.code === expected && !error.message.includes('dummy-value');
    for (const kind of ['ports', 'cores', 'libraries'] as const) {
        f.workspace.isTrusted = true;
        f.setDiscovery({ exitCode: 4, stderr: 'password=dummy-value\n', canceled: false });
        await assert.rejects(f.cli.discoverForAssistant(kind, new AbortController().signal), rejected('CLI_FAILED'));
        f.setDiscovery({ exitCode: 0, stdout: '{invalid}', stderr: '' });
        await assert.rejects(f.cli.discoverForAssistant(kind, new AbortController().signal), rejected('INVALID_CLI_OUTPUT'));
        f.setDiscovery({ truncated: true });
        await assert.rejects(f.cli.discoverForAssistant(kind, new AbortController().signal), rejected('OUTPUT_LIMIT'));
        f.setDiscovery({ truncated: false, canceled: true });
        await assert.rejects(f.cli.discoverForAssistant(kind, new AbortController().signal), rejected('CANCELED'));
        const calls = f.calls.length;
        f.workspace.isTrusted = false;
        await assert.rejects(f.cli.discoverForAssistant(kind, new AbortController().signal), rejected('WORKSPACE_UNTRUSTED'));
        assert.equal(f.calls.length, calls);
    }
});

test('actual extension inventory rejects arbitrary operations and pre-canceled or unavailable requests without spawning', async (t) => {
    const f = host(t);
    await assert.rejects(f.cli.discoverForAssistant('install' as 'cores', new AbortController().signal), { code: 'INVALID_ARGUMENT' });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.cli.discoverForAssistant('cores', controller.signal), { code: 'CANCELED' });
    f.cli.arduinoCLIPath = '';
    await assert.rejects(f.cli.discoverForAssistant('libraries', new AbortController().signal), { code: 'CLI_NOT_READY' });
    assert.equal(f.calls.length, 0);
});

test('actual extension inventory rechecks cancellation and trust before returning results', async (t) => {
    const f = host(t);
    f.setDiscovery({ stdout: '{"platforms":[]}' });
    const controller = new AbortController();
    f.onDiscovery(() => controller.abort());
    await assert.rejects(f.cli.discoverForAssistant('cores', controller.signal), { code: 'CANCELED' });
    f.setDiscovery({ stdout: '{"installed_libraries":[]}' });
    f.onDiscovery(() => { f.workspace.isTrusted = false; });
    await assert.rejects(f.cli.discoverForAssistant('libraries', new AbortController().signal), { code: 'WORKSPACE_UNTRUSTED' });
    assert.equal(f.calls.length, 2);
});

test('assistant discovery queries use inspected targets and fixed JSON commands without changing Home', async (t) => {
    const f = host(t);
    const signal = new AbortController().signal;
    const fqbn = 'esp32:esp32:esp32:FlashSize=8M,CPUFreq=160';
    const cases: { query: AiDiscoveryQuery; output: unknown; args: string[] }[] = [
        {
            query: { kind: 'boardDetails', sketchPath: f.sketch, fqbn: 'esp32:esp32:esp32' },
            output: { fqbn: 'esp32:esp32:esp32', config_options: [{ option: 'CPUFreq', values: [{ value: '240', selected: true }] }] },
            args: ['board', 'details', '--fqbn', 'esp32:esp32:esp32', '--json']
        },
        {
            query: { kind: 'librarySearch', sketchPath: f.sketch, query: 'name:"Adafruit NeoPixel"' },
            output: { libraries: [{ name: 'Adafruit NeoPixel', latest: { version: '1.0.0' }, available_versions: ['1.0.0'] }], status: 'success' },
            args: ['lib', 'search', '--omit-releases-details', '--json', '--', 'name:"Adafruit NeoPixel"']
        },
        {
            query: { kind: 'examples', sketchPath: f.sketch, fqbn },
            output: { installed_libraries: [{ library: { name: 'SPI', location: 'platform', examples: ['SPI/Transfer'] } }] },
            args: ['lib', 'list', '--all', '--fqbn', fqbn, '--json']
        },
        {
            query: { kind: 'examples', sketchPath: f.sketch },
            output: { installed_libraries: [] },
            args: ['lib', 'list', '--all', '--json']
        }
    ];
    for (const { query, output, args } of cases) {
        f.setDiscovery({ stdout: JSON.stringify(output), stderr: '' });
        assert.deepEqual(await f.cli.queryForAssistant(query, signal), output);
        const call = f.calls.at(-1)!;
        assert.equal(call.executable, process.execPath);
        assert.deepEqual(call.args, args);
        assert.equal(call.options.cwd, f.sketch);
        assert.equal(call.options.signal, signal);
        assert.equal(call.options.maxOutputBytes, 2 * 1024 * 1024);
    }
    assert.equal(f.statuses.length, 0);
    assert.equal(f.displayed.length, 0);
    assert.equal(f.invalidations(), 0);
    assert.equal(f.saves(), 0);
    assert.equal(fs.existsSync(f.target().buildPath), false);
    assert.equal(fs.readFileSync(f.configurationPath, 'utf8'), f.configuration);
});

test('assistant library search treats option-like text and shell metacharacters as one query argument', async (t) => {
    const f = host(t);
    f.setDiscovery({ stdout: '{"libraries":[]}' });
    for (const query of ['--config-file=other.yaml', 'name:"LED Strip"; & echo value', 'a$(echo value)`echo value`']) {
        await f.cli.queryForAssistant({ kind: 'librarySearch', sketchPath: f.sketch, query }, new AbortController().signal);
        assert.deepEqual(f.calls.at(-1)?.args, ['lib', 'search', '--omit-releases-details', '--json', '--', query]);
    }
});

test('assistant discovery queries reject invalid inputs and unavailable requests before spawning', async (t) => {
    const f = host(t);
    const invalid: unknown[] = [
        undefined, null,
        { kind: 'install', sketchPath: f.sketch },
        { kind: 'examples', sketchPath: 'relative/sketch' },
        { kind: 'examples', sketchPath: f.sketch + '\0' },
        { kind: 'boardDetails', sketchPath: f.sketch },
        { kind: 'boardDetails', sketchPath: f.sketch, fqbn: '   ' },
        { kind: 'examples', sketchPath: f.sketch, fqbn: 'arduino:avr:uno\n--config-file=other' },
        ...['', '  ', 'x'.repeat(257), 'led\0', 'led\r', 'led\n'].map(query => ({ kind: 'librarySearch', sketchPath: f.sketch, query }))
    ];
    for (const query of invalid) {
        await assert.rejects(f.cli.queryForAssistant(query as AiDiscoveryQuery, new AbortController().signal), { code: 'INVALID_ARGUMENT' });
    }
    const query: AiDiscoveryQuery = { kind: 'examples', sketchPath: f.sketch };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.cli.queryForAssistant(query, controller.signal), { code: 'CANCELED' });
    f.workspace.isTrusted = false;
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'WORKSPACE_UNTRUSTED' });
    f.workspace.isTrusted = true;
    f.cli.compileOrUploadRunning = true;
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'BUSY' });
    f.cli.compileOrUploadRunning = false;
    f.cli.arduinoCLIPath = '';
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'CLI_NOT_READY' });
    assert.equal(f.calls.length, 0);
});

test('assistant discovery queries reject failed, oversized or malformed output and redact diagnostics', async (t) => {
    const f = host(t);
    const query: AiDiscoveryQuery = { kind: 'librarySearch', sketchPath: f.sketch, query: 'led' };
    f.setDiscovery({ exitCode: 3, stderr: 'token=dummy-secret' });
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), (error: unknown) =>
        error instanceof AiBridgeError && error.code === 'CLI_FAILED' && !error.message.includes('dummy-secret'));
    f.setDiscovery({ exitCode: 0, stderr: '', stdout: 'not JSON' });
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'INVALID_CLI_OUTPUT' });
    f.setDiscovery({ truncated: true });
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'OUTPUT_LIMIT' });
    f.setDiscovery({ truncated: false, canceled: true });
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'CANCELED' });
});

test('assistant discovery queries recheck cancellation and trust after the CLI returns', async (t) => {
    const f = host(t);
    const query: AiDiscoveryQuery = { kind: 'examples', sketchPath: f.sketch, fqbn: 'arduino:avr:uno' };
    f.setDiscovery({ stdout: '{"installed_libraries":[]}' });
    const controller = new AbortController();
    f.onDiscovery(() => controller.abort());
    await assert.rejects(f.cli.queryForAssistant(query, controller.signal), { code: 'CANCELED' });
    f.onDiscovery(() => { f.workspace.isTrusted = false; });
    await assert.rejects(f.cli.queryForAssistant(query, new AbortController().signal), { code: 'WORKSPACE_UNTRUSTED' });
    assert.equal(f.calls.length, 2);
});

test('successful discovery with stderr diagnostics reports incomplete initialization without exposing details', async (t) => {
    const f = host(t);
    f.setDiscovery({ stdout: '{"status":"success","libraries":[],"warnings":["Existing warning"]}', stderr: 'Error initializing instance at private-location' });
    const result = await f.cli.queryForAssistant({ kind: 'librarySearch', sketchPath: f.sketch, query: 'sensor' }, new AbortController().signal) as {
        warnings: string[];
    };
    assert.equal(result.warnings.length, 2);
    assert.equal(result.warnings[0], 'Existing warning');
    assert.doesNotMatch(JSON.stringify(result), /private-location/);
    f.setDiscovery({ stdout: '{"status":"success","libraries":[],"warnings":"invalid"}' });
    await assert.rejects(f.cli.queryForAssistant({ kind: 'librarySearch', sketchPath: f.sketch, query: 'sensor' }, new AbortController().signal), { code: 'INVALID_CLI_OUTPUT' });
});
