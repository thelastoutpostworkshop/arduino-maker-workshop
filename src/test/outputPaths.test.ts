import * as assert from 'assert';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { Script } from 'vm';
import { PROFILES_STATUS } from '../shared/messages';

// Isolate the extension's UI singletons while exercising the compiled production modules.
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

function createFixture(paths: typeof path, projectPath: string, output?: string) {
    let profilesActive = false;
    const extension: Record<string, unknown> = {
        arduinoExtensionChannel: { appendLine: () => {} },
        arduinoYaml: {
            status: () => profilesActive ? PROFILES_STATUS.ACTIVE : PROFILES_STATUS.INACTIVE,
            getProfileName: () => 'esp32',
            getBuildFolderProfileName: () => 'build_esp32',
            getProfileBuildProperties: () => [],
            getProfile: () => ({ fqbn: 'esp32:esp32:esp32' }),
        },
    };
    const dependencies = {
        path: paths,
        './extension': extension,
        './VueWebviewPanel': { VueWebviewPanel: { sendMessage: () => {} } },
        vscode: {
            workspace: {
                workspaceFolders: [{ uri: { fsPath: projectPath } }],
                getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
            },
            window: { showWarningMessage: (message: string) => { throw new Error(message); } },
        },
    };
    const { ArduinoProject, UPLOAD_READY_STATUS } = loadModule<typeof import('../ArduinoProject')>('../ArduinoProject', dependencies);
    const { CLIArguments } = loadModule<typeof import('../cliArgs')>('../cliArgs', dependencies);
    const project = new ArduinoProject();
    const configuration = project.getArduinoConfiguration();
    if (output !== undefined) {
        configuration.output = output;
    }
    configuration.board = 'esp32:esp32:esp32';
    configuration.port = 'COM3';
    configuration.compile_profile = 'esp32';
    // Argument generation must not read or write a real workspace's configuration.
    project.readConfiguration = () => true;
    extension.arduinoProject = project;
    const args = new CLIArguments();
    extension.arduinoCLI = { getBuildPath: () => args.getBuildPath() };
    return { project, args, UPLOAD_READY_STATUS, setProfilesActive: (active: boolean) => { profilesActive = active; } };
}

function option(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    assert.ok(index >= 0, `Missing ${flag} in ${args.join(' ')}`);
    return args[index + 1];
}

suite('Output paths (issue #128)', () => {
    const cases: { name: string; paths: typeof path; project: string; output?: string; expected: string }[] = [
        { name: 'Windows default', paths: path.win32, project: 'C:\\sketches\\Blink', expected: 'C:\\sketches\\Blink\\build' },
        { name: 'Windows relative', paths: path.win32, project: 'C:\\sketches\\Blink', output: 'artifacts/build', expected: 'C:\\sketches\\Blink\\artifacts\\build' },
        { name: 'Windows parent relative', paths: path.win32, project: 'C:\\sketches\\Blink', output: '../builds/Blink', expected: 'C:\\sketches\\builds\\Blink' },
        { name: 'another Windows drive', paths: path.win32, project: 'C:\\sketches\\Blink', output: 'E:\\builds\\Blink', expected: 'E:\\builds\\Blink' },
        { name: 'Windows spaces and forward slashes', paths: path.win32, project: 'C:\\sketches\\Blink', output: 'E:/Arduino Builds/Blink', expected: 'E:\\Arduino Builds\\Blink' },
        { name: 'Windows UNC', paths: path.win32, project: 'C:\\sketches\\Blink', output: '\\\\server\\share\\builds\\Blink', expected: '\\\\server\\share\\builds\\Blink' },
        { name: 'absolute inside Windows workspace', paths: path.win32, project: 'C:\\sketches\\Blink', output: 'C:\\sketches\\Blink\\artifacts', expected: 'C:\\sketches\\Blink\\artifacts' },
        { name: 'POSIX default', paths: path.posix, project: '/home/user/Blink', expected: '/home/user/Blink/build' },
        { name: 'POSIX relative', paths: path.posix, project: '/home/user/Blink', output: 'artifacts/build', expected: '/home/user/Blink/artifacts/build' },
        { name: 'POSIX parent relative', paths: path.posix, project: '/home/user/Blink', output: '../builds/Blink', expected: '/home/user/builds/Blink' },
        { name: 'POSIX absolute with spaces', paths: path.posix, project: '/home/user/Blink', output: '/tmp/Arduino Builds/Blink', expected: '/tmp/Arduino Builds/Blink' },
    ];

    for (const entry of cases) {
        test(`${entry.name} stays consistent for compile, upload, debug and profiles`, () => {
            const fixture = createFixture(entry.paths, entry.project, entry.output);
            assert.strictEqual(fixture.project.getOutputPath(), entry.expected);
            assert.strictEqual(fixture.project.getOutput(), entry.output ?? 'build');

            for (const active of [false, true]) {
                fixture.setProfilesActive(active);
                const expectedBuild = active ? entry.paths.join(entry.expected, 'build_esp32') : entry.expected;
                assert.strictEqual(fixture.args.getBuildPath(), expectedBuild);
                assert.strictEqual(option(fixture.args.getCompileCommandArguments(false, false, false), '--build-path'), expectedBuild);
                assert.strictEqual(option(fixture.args.getUploadArguments(), '--input-dir'), expectedBuild);
                assert.strictEqual(option(fixture.args.getDebugInfoArguments(), '--build-path'), expectedBuild);
                assert.strictEqual(option(fixture.args.getCompileCommandArguments(false, false, false, true), '--build-path'), entry.expected);
            }
            assert.strictEqual(fixture.project.getArduinoConfiguration().output, entry.output ?? 'build');
        });
    }

    test('Windows output exclusions ignore casing but preserve directory boundaries', () => {
        const { project } = createFixture(path.win32, 'C:\\sketches\\Blink', 'c:\\SKETCHES\\blink\\build');
        assert.strictEqual(project.isInOutputDirectory('C:\\sketches\\Blink\\build'), true);
        assert.strictEqual(project.isInOutputDirectory('C:\\sketches\\Blink\\BUILD\\sketch\\Blink.ino.cpp'), true);
        assert.strictEqual(project.isInOutputDirectory('C:\\sketches\\Blink\\build-other\\source.cpp'), false);
        assert.strictEqual(project.isInOutputDirectory('C:\\sketches\\Blink\\build\\..\\Blink.ino'), false);
        assert.strictEqual(project.isInOutputDirectory('D:\\sketches\\Blink\\build\\source.cpp'), false);
    });

    test('an absolute output inside the workspace is excluded from upload freshness checks', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arduino-output-paths-'));
        try {
            const output = path.join(root, 'artifacts');
            const source = path.join(root, 'Blink.ino');
            fs.mkdirSync(path.join(output, 'sketch'), { recursive: true });
            fs.writeFileSync(source, 'void setup() {}\nvoid loop() {}\n');
            const result = path.join(output, 'compile_result.json');
            fs.writeFileSync(result, JSON.stringify({ result: true }));
            const generated = path.join(output, 'sketch', 'Blink.ino.cpp');
            fs.writeFileSync(generated, '// generated source\n');
            fs.utimesSync(source, 1_700_000_000, 1_700_000_000);
            fs.utimesSync(result, 1_700_000_100, 1_700_000_100);
            fs.utimesSync(generated, 1_700_000_200, 1_700_000_200);

            const configuredOutput = process.platform === 'win32' ? output.toUpperCase() : output;
            const fixture = createFixture(path, root, configuredOutput);
            assert.strictEqual(fixture.project.isUploadReady(), fixture.UPLOAD_READY_STATUS.READY);
            fs.utimesSync(source, 1_700_000_300, 1_700_000_300);
            assert.strictEqual(fixture.project.isUploadReady(), fixture.UPLOAD_READY_STATUS.LAST_COMPILE_FAILED);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
