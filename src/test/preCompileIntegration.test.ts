import * as assert from 'assert';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { Script } from 'vm';
import type { CancellationToken, ExtensionContext } from 'vscode';
import { PROFILES_STATUS } from '../shared/messages';

// Replace service boundaries while running the compiled production compile method.
function loadModule<T>(name: string, dependencies: Record<string, unknown>): T {
    const filename = require.resolve(name);
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    const source = fs.readFileSync(filename, 'utf8');
    const load = new Script(`(function(require, module, exports) { ${source}\n})`, { filename }).runInThisContext();
    load((id: string) => Object.prototype.hasOwnProperty.call(dependencies, id)
        ? dependencies[id] : localRequire(id), module, module.exports);
    return module.exports as T;
}

interface HookOptions {
    cwd: string;
    token: CancellationToken;
    onOutput: (output: string) => void;
}

class CancelledHookError extends Error {}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createFixture(options: {
    script?: string;
    projectPath?: string;
    runHook?: (command: string, options: HookOptions) => Promise<void>;
} = {}) {
    const projectPath = options.projectPath ?? path.resolve('test-sketch');
    const buildPath = path.join(projectPath, 'build');
    let buildResult = true;
    let compilerCalls = 0;
    let refreshCalls = 0;
    const hookCalls: { command: string; options: HookOptions }[] = [];
    const progressTokens: { cancel: () => void }[] = [];
    const messages: { command: string; payload?: unknown }[] = [];
    const vscode = {
        commands: { executeCommand: async () => {} },
        ProgressLocation: { Notification: 15 },
        workspace: {
            saveAll: async () => true,
            workspaceFolders: [{ uri: { fsPath: projectPath } }],
            getConfiguration: () => ({
                get: (_key: string, fallback: unknown) => options.script ?? fallback,
            }),
        },
        window: {
            withProgress: async (_options: unknown, callback: (progress: unknown, token: CancellationToken) => Promise<unknown>) => {
                const listeners = new Set<() => void>();
                let cancelled = false;
                const token = {
                    get isCancellationRequested() { return cancelled; },
                    onCancellationRequested: (listener: () => void) => {
                        listeners.add(listener);
                        return { dispose: () => listeners.delete(listener) };
                    },
                } as CancellationToken;
                progressTokens.push({ cancel: () => {
                    cancelled = true;
                    for (const listener of listeners) {
                        listener();
                    }
                } });
                return callback({}, token);
            },
        },
    };
    const { CliOutputView } = loadModule<typeof import('../cliOutputView')>('../cliOutputView', {
        vscode,
        ansi_up: { AnsiUp: class {
            use_classes = false;
            ansi_to_html(text: string) { return text; }
        } },
    });
    const view = new CliOutputView({} as ExtensionContext);
    Object.assign(view, { postMessage: (message: { command: string; payload?: unknown }) => messages.push(message) });
    const viewState = view as unknown as {
        bufferedHtml: string;
        lastStatusPayload: { state: string; text: string } | undefined;
    };
    const extension: Record<string, unknown> = {
        compileOutputView: view,
        compileStatusBarItem: { text: 'idle' },
        compileStatusBarNotExecuting: 'idle',
        compileStatusBarExecuting: 'busy',
        updateStateCompileUpload: () => { refreshCalls++; },
        arduinoYaml: { status: () => PROFILES_STATUS.INACTIVE },
        arduinoProject: { optimizeForDebug: () => false, isConfigurationRequired: () => false },
    };
    const { ArduinoCLI } = loadModule<typeof import('../cli')>('../cli', {
        vscode,
        './extension': extension,
        './ArduinoProject': { COMPILE_RESULT_FILE: 'compile_result.json' },
        './cliArgs': {},
        './config': {},
        './cliCache': {},
        './debugConfiguration': {},
        '@microsoft/vscode-serial-monitor-api': {},
        './preCompileScript': {
            PreCompileScriptCancelledError: CancelledHookError,
            runPreCompileScript: async (command: string, hookOptions: HookOptions) => {
                hookCalls.push({ command, options: hookOptions });
                await options.runHook?.(command, hookOptions);
            },
        },
        fs: {
            existsSync: (filename: string) => filename === buildPath,
            writeFileSync: (filename: string, contents: string) => {
                assert.strictEqual(filename, path.join(buildPath, 'compile_result.json'));
                buildResult = JSON.parse(contents).result;
            },
        },
    });
    const cli = Object.create(ArduinoCLI.prototype) as InstanceType<typeof ArduinoCLI>;
    Object.assign(cli, {
        compileOrUploadRunning: false,
        cliArgs: { getVerboseOption: () => false, getCompileCommandArguments: () => ['compile'] },
        getBuildPath: () => buildPath,
        createIntellisenseFile: () => {},
        runArduinoCommand: async (getArgs: () => string[]) => {
            assert.deepStrictEqual(getArgs(), ['compile']);
            compilerCalls++;
            view.appendInfo(`Compiler run ${compilerCalls}\n`);
            return '';
        },
    });
    extension.arduinoCLI = cli;
    return {
        cli, view, hookCalls, messages,
        cancelHook: () => progressTokens[0].cancel(),
        get output() { return viewState.bufferedHtml; },
        get status() { return viewState.lastStatusPayload; },
        get buildResult() { return buildResult; },
        get compilerCalls() { return compilerCalls; },
        get refreshCalls() { return refreshCalls; },
    };
}

suite('Pre-compile script integration', () => {
    test('each compile without a hook clears earlier output', async () => {
        const fixture = createFixture();
        fixture.view.appendInfo('Previous error marker\n');
        await fixture.cli.compile();
        assert.ok(!fixture.output.includes('Previous error marker'));
        assert.ok(fixture.output.includes('Compiler run 1'));

        await fixture.cli.compile();
        assert.ok(!fixture.output.includes('Compiler run 1'));
        assert.ok(fixture.output.includes('Compiler run 2'));
        assert.strictEqual(fixture.messages.filter(message => message.command === 'clear').length, 2);
        assert.strictEqual(fixture.hookCalls.length, 0);
    });

    test('a successful hook retains its output through compilation', async () => {
        const fixture = createFixture({
            script: 'generate-version',
            runHook: async (_command, options) => {
                options.onOutput('Hook stdout marker\n');
                options.onOutput('Hook stderr marker\n');
            },
        });
        fixture.view.appendInfo('Previous output marker\n');
        await fixture.cli.compile();
        assert.ok(!fixture.output.includes('Previous output marker'));
        assert.ok(fixture.output.includes('Hook stdout marker'));
        assert.ok(fixture.output.includes('Hook stderr marker'));
        assert.ok(fixture.output.indexOf('Hook stdout marker') < fixture.output.indexOf('Compiler run 1'));
        assert.strictEqual(fixture.messages.filter(message => message.command === 'clear').length, 1);
        assert.strictEqual(fixture.compilerCalls, 1);
        assert.strictEqual(fixture.buildResult, true);
        assert.strictEqual(fixture.status?.state, 'success');
    });

    test('a failed hook invalidates a previous build and skips the compiler', async () => {
        const fixture = createFixture({
            script: 'generate-version',
            runHook: async () => { throw new Error('Version generation failed'); },
        });
        assert.strictEqual(fixture.buildResult, true);
        assert.strictEqual(await fixture.cli.compile(), '');
        assert.strictEqual(fixture.buildResult, false);
        assert.strictEqual(fixture.compilerCalls, 0);
        assert.strictEqual(fixture.cli.compileOrUploadRunning, false);
        assert.strictEqual(fixture.refreshCalls, 1);
        assert.strictEqual(fixture.status?.state, 'failure');
        assert.ok(fixture.output.includes('Version generation failed'));
    });

    test('cancellation keeps compilation busy until the hook finishes cleanup', async () => {
        const started = deferred<void>();
        const stopped = deferred<void>();
        let cancellationRequested = false;
        const fixture = createFixture({
            script: 'generate-version',
            runHook: async (_command, options) => {
                options.token.onCancellationRequested(() => { cancellationRequested = true; });
                started.resolve();
                await stopped.promise;
            },
        });
        const compiling = fixture.cli.compile();
        await started.promise;
        fixture.cancelHook();
        assert.strictEqual(cancellationRequested, true);
        assert.strictEqual(fixture.cli.compileOrUploadRunning, true);
        assert.strictEqual(fixture.refreshCalls, 0);
        assert.strictEqual(fixture.compilerCalls, 0);
        assert.strictEqual(await fixture.cli.compile(), '');
        assert.strictEqual(fixture.hookCalls.length, 1);

        stopped.reject(new CancelledHookError('Pre-compile script was cancelled by the user.'));
        assert.strictEqual(await compiling, '');
        assert.strictEqual(fixture.buildResult, false);
        assert.strictEqual(fixture.cli.compileOrUploadRunning, false);
        assert.strictEqual(fixture.compilerCalls, 0);
        assert.strictEqual(fixture.refreshCalls, 1);
        assert.strictEqual(fixture.status?.state, 'canceled');
    });

    test('whitespace-only configuration skips the hook', async () => {
        const fixture = createFixture({ script: ' \t\n ' });
        await fixture.cli.compile();
        assert.strictEqual(fixture.hookCalls.length, 0);
        assert.strictEqual(fixture.compilerCalls, 1);
    });

    test('workspace substitution preserves dollar signs and expands both aliases', async () => {
        const projectPath = path.resolve('sketch $& directory');
        const fixture = createFixture({
            projectPath,
            script: '  generator "${workspaceFolder}/version.h" "${workspaceRoot}/input.json"  ',
        });
        await fixture.cli.compile();
        assert.strictEqual(fixture.hookCalls.length, 1);
        assert.strictEqual(fixture.hookCalls[0].command, `generator "${projectPath}/version.h" "${projectPath}/input.json"`);
        assert.strictEqual(fixture.hookCalls[0].options.cwd, projectPath);
    });
});
