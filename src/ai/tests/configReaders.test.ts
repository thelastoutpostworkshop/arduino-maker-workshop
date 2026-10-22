import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import * as ts from 'typescript';

interface ProjectReader {
    readConfiguration(): boolean;
    setPort(port: string): void;
    setBoard(board: string): void;
    getBoard(): string;
    getMonitorPortSettings(): { port: string; baudRate: number };
    getArduinoConfiguration(): { schemaVersion: number };
}

interface ProfileReader {
    getYaml(): { profiles: Record<string, unknown> } | undefined;
    getLastError(): string;
    refreshProjectState(): void;
}

function fixture(t: TestContext) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amw-config-readers-'));
    t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
    const sketch = path.join(root, 'sketch-a');
    const otherSketch = path.join(root, 'sketch-b');
    fs.mkdirSync(sketch);
    fs.mkdirSync(otherSketch);
    const vscode = {
        workspace: { workspaceFolders: [{ uri: { fsPath: sketch } }] },
        window: { showErrorMessage() {} },
    };
    let invalidations = 0;
    const extension: {
        arduinoProject?: ProjectReader;
        arduinoExtensionChannel: { appendLine(): void };
        arduinoCLI: { setBuildResult(value: boolean): void };
        updateStateCompileUpload(): void;
    } = {
        arduinoExtensionChannel: { appendLine() {} },
        arduinoCLI: { setBuildResult(value) { assert.equal(value, false); invalidations++; } },
        updateStateCompileUpload() {},
    };
    const webview = { VueWebviewPanel: { sendMessage() {} }, sendBuildProfiles() {} };
    const repo = process.cwd();
    const repoRequire = createRequire(path.join(repo, 'package.json'));
    let messages: typeof import('../../shared/messages');
    function load<T>(relative: string): T {
        const filename = path.join(repo, relative);
        const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const module = { exports: {} as T };
        const customRequire = (name: string) => {
            if (name === 'vscode') { return vscode; }
            if (name === './extension') { return extension; }
            if (name === './VueWebviewPanel') { return webview; }
            if (name === './shared/messages') { return messages; }
            if (name === '@microsoft/vscode-serial-monitor-api') {
                return {
                    LineEnding: { None: 'none', LF: '\n', CR: '\r', CRLF: '\r\n' },
                    Parity: { None: 'none', Odd: 'odd', Even: 'even', Mark: 'mark', Space: 'space' },
                    StopBits: { One: 'one', Onepointfive: 'onepointfive', Two: 'two' },
                };
            }
            if (name === 'path') { return path; }
            if (name === 'fs') { return fs; }
            if (name === 'yaml') { return repoRequire(name); }
            throw new Error(`Unexpected reader dependency: ${name}`);
        };
        vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(customRequire, module, module.exports);
        return module.exports;
    }
    messages = load('src/shared/messages.ts');
    const projectModule = load<{ ArduinoProject: new () => ProjectReader }>('src/ArduinoProject.ts');
    const profileModule = load<{ SketchProfileManager: new () => ProfileReader }>('src/sketchProfileManager.ts');
    const project = new projectModule.ArduinoProject();
    extension.arduinoProject = project;
    const profiles = new profileModule.SketchProfileManager();
    const configPath = path.join(sketch, '.vscode', 'arduino.json');
    const yamlPath = path.join(sketch, messages.YAML_FILENAME);
    const inactiveYamlPath = path.join(sketch, messages.YAML_FILENAME_INACTIVE);
    function writeConfig(content: string) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, content);
    }
    return {
        project, profiles, sketch, otherSketch, configPath, yamlPath, inactiveYamlPath, writeConfig,
        changeSketch: (fsPath: string) => { vscode.workspace.workspaceFolders = [{ uri: { fsPath } }]; },
        invalidations: () => invalidations,
    };
}

test('configuration inspection preserves missing and legacy files; explicit setters persist normalized state', t => {
    const f = fixture(t);
    assert.equal(f.project.readConfiguration(), true);
    assert.equal(fs.existsSync(path.join(f.sketch, '.vscode')), false);
    f.project.setPort('COM_TEST');
    assert.equal(JSON.parse(fs.readFileSync(f.configPath, 'utf8')).monitorPortSettings.port, 'COM_TEST');

    const legacy = JSON.stringify({
        board: 'arduino:avr:uno', port: 'COM_TEST', monitorPortSettings: { settings: { baudRate: 9600 } },
    }, null, 4);
    f.writeConfig(legacy);
    assert.equal(f.project.readConfiguration(), true);
    assert.equal(f.project.getBoard(), 'arduino:avr:uno');
    assert.equal(f.project.getMonitorPortSettings().baudRate, 9600);
    assert.equal(f.project.getMonitorPortSettings().port, 'COM_TEST');
    assert.equal(f.project.getArduinoConfiguration().schemaVersion, 1);
    assert.equal(fs.readFileSync(f.configPath, 'utf8'), legacy);

    f.project.setBoard('arduino:avr:nano');
    const persisted = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.board, 'arduino:avr:nano');
    assert.equal(persisted.monitorPortSettings.baudRate, 9600);
    assert.equal(persisted.monitorPortSettings.settings, undefined);
});

test('switched, deleted, or malformed configuration cannot retain a previous target', t => {
    const f = fixture(t);
    f.writeConfig('{"board":"arduino:avr:uno"}');
    assert.equal(f.project.readConfiguration(), true);
    f.changeSketch(f.otherSketch);
    assert.equal(f.project.readConfiguration(), true);
    assert.equal(f.project.getBoard(), '');
    assert.equal(fs.existsSync(path.join(f.otherSketch, '.vscode')), false);
    f.changeSketch(f.sketch);

    for (const invalid of ['{broken', 'null', '[]', '{"board":42}', '{"monitorPortSettings":null}']) {
        f.writeConfig('{"board":"arduino:avr:uno"}');
        assert.equal(f.project.readConfiguration(), true);
        f.writeConfig(invalid);
        assert.equal(f.project.readConfiguration(), false);
        assert.equal(f.project.getBoard(), '');
        assert.equal(fs.readFileSync(f.configPath, 'utf8'), invalid);
    }
    f.writeConfig('{"board":"arduino:avr:uno"}');
    assert.equal(f.project.readConfiguration(), true);
    fs.unlinkSync(f.configPath);
    assert.equal(f.project.readConfiguration(), true);
    assert.equal(f.project.getBoard(), '');
    assert.equal(fs.existsSync(f.configPath), false);
});

test('defaults-only and malformed YAML inspection preserves original files and active status', t => {
    const f = fixture(t);
    for (const content of ['default_fqbn: arduino:avr:uno\ndefault_port: COM_TEST\n', 'profiles: {}\n']) {
        fs.writeFileSync(f.yamlPath, content);
        assert.deepEqual(f.profiles.getYaml()?.profiles, {});
        assert.equal(fs.readFileSync(f.yamlPath, 'utf8'), content);
        assert.equal(fs.existsSync(f.inactiveYamlPath), false);
    }
    for (const content of ['profiles: [', 'profiles: []\n', 'profiles:\n  broken: null\n', '[]\n', 'null\n']) {
        fs.writeFileSync(f.yamlPath, content);
        assert.equal(f.profiles.getYaml(), undefined);
        assert.notEqual(f.profiles.getLastError(), '');
        assert.equal(fs.readFileSync(f.yamlPath, 'utf8'), content);
        assert.equal(fs.existsSync(f.inactiveYamlPath), false);
    }
    const inactiveContent = fs.readFileSync(f.yamlPath, 'utf8');
    fs.unlinkSync(f.yamlPath);
    fs.writeFileSync(f.inactiveYamlPath, inactiveContent);
    assert.equal(f.profiles.getYaml(), undefined);
    assert.notEqual(f.profiles.getLastError(), '');
    assert.equal(fs.readFileSync(f.inactiveYamlPath, 'utf8'), inactiveContent);
    assert.equal(fs.existsSync(f.yamlPath), false);
});

test('profile inspection invalidates changed targets and malformed active profiles, while allowing port changes', t => {
    const f = fixture(t);
    f.writeConfig('{"compile_profile":"uno"}');
    assert.equal(f.project.readConfiguration(), true);
    f.profiles.refreshProjectState();
    fs.writeFileSync(f.yamlPath, 'profiles:\n  uno:\n    fqbn: arduino:avr:uno\n    port: COM_TEST\n');
    assert.ok(f.profiles.getYaml());
    const baseline = f.invalidations();
    fs.writeFileSync(f.yamlPath, 'profiles:\n  uno:\n    fqbn: arduino:avr:uno\n    port: COM_OTHER\n');
    assert.ok(f.profiles.getYaml());
    assert.equal(f.invalidations(), baseline);
    fs.writeFileSync(f.yamlPath, 'profiles:\n  uno:\n    fqbn: arduino:avr:nano\n');
    assert.ok(f.profiles.getYaml());
    assert.equal(f.invalidations(), baseline + 1);
    fs.writeFileSync(f.yamlPath, 'profiles: [');
    assert.equal(f.profiles.getYaml(), undefined);
    assert.equal(f.invalidations(), baseline + 2);
    assert.equal(f.profiles.getYaml(), undefined);
    assert.equal(f.invalidations(), baseline + 2);
});
