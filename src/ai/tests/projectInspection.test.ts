import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AiBridgeError, AiOperationResult } from '../contracts';
import { createAiOperationHandler } from '../operations';
import { inspectProject } from '../projectInspection';
import { unavailableCompileOutput } from '../compileOutput';
import { unavailableCompileArtifacts } from '../compileArtifacts';

function fixture(t: { after: (fn: () => void) => void }, name = 'Blink') {
    const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'amw-inspection-')));
    const sketch = path.join(temporary, name);
    fs.mkdirSync(sketch);
    fs.writeFileSync(path.join(sketch, `${name}.ino`), 'void setup() {}\nvoid loop() {}\n');
    t.after(() => {
        assert.equal(path.dirname(temporary), fs.realpathSync.native(os.tmpdir()));
        assert.ok(path.basename(temporary).startsWith('amw-inspection-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    return {
        temporary,
        sketch,
        config(value: unknown) {
            fs.mkdirSync(path.join(sketch, '.vscode'), { recursive: true });
            const file = path.join(sketch, '.vscode', 'arduino.json');
            fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
            return file;
        },
        yaml(value: string) {
            const file = path.join(sketch, 'sketch.yaml');
            fs.writeFileSync(file, value);
            return file;
        },
    };
}

function hasCode(code: string) {
    return (error: unknown) => error instanceof AiBridgeError && error.code === code;
}

test('resolves standard saved board options, debug and clean arguments', (t) => {
    const f = fixture(t);
    f.config({ board: 'esp32:esp32:esp32', configuration: 'FlashMode=qio,CPUFreq=240', port: 'COM7', output: 'output', optimize_for_debug: true, useProgrammer: true, programmer: 'esp-prog', privateSetting: 'do-not-return' });
    const result = inspectProject({ sketchPath: f.sketch, clean: true }, f.sketch);
    assert.equal(result.canCompile, true);
    assert.equal(result.fqbn, 'esp32:esp32:esp32:FlashMode=qio,CPUFreq=240');
    assert.equal(result.port, 'COM7');
    assert.equal(result.programmer, 'esp-prog');
    assert.equal(result.buildPath, path.join(f.sketch, 'output'));
    assert.deepEqual(result.compileArgs, ['compile', '--fqbn', result.fqbn, '--build-path', result.buildPath, '--no-color', '--jobs', '0', '--optimize-for-debug', '--clean', f.sketch]);
    assert.ok(!JSON.stringify(result).includes('do-not-return'));
});

test('accepts defaults-only YAML without creating or repairing Arduino configuration', (t) => {
    const f = fixture(t);
    const original = 'default_fqbn: arduino:avr:uno\ndefault_port: COM8\ndefault_protocol: serial\ndefault_programmer: usbasp\n';
    const yaml = f.yaml(original);
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, true);
    assert.equal(result.fqbn, 'arduino:avr:uno');
    assert.equal(result.port, 'COM8');
    assert.equal(result.protocol, 'serial');
    assert.equal(result.programmer, 'usbasp');
    assert.equal(result.resolvedProfile, undefined);
    assert.equal(fs.existsSync(path.join(f.sketch, '.vscode')), false);
    assert.equal(fs.readFileSync(yaml, 'utf8'), original);
    assert.equal(fs.existsSync(`${yaml}.disabled`), false);
});

test('saved default sentinel follows YAML default even when it is not first', (t) => {
    const f = fixture(t);
    f.config({ compile_profile: 'default_profile' });
    f.yaml('profiles:\n  first:\n    fqbn: arduino:avr:uno\n  actual:\n    fqbn: esp32:esp32:esp32:FlashMode=qio\n    build_properties:\n      - build.extra_flags=-DTEST=1\ndefault_profile: actual\ndefault_port: COM9\ndefault_protocol: serial\n');
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.selectedProfile, 'default_profile');
    assert.equal(result.resolvedProfile, 'actual');
    assert.equal(result.fqbn, 'esp32:esp32:esp32:FlashMode=qio');
    assert.equal(result.port, 'COM9');
    assert.equal(result.protocol, 'serial');
    assert.equal(result.buildPath, path.join(f.sketch, 'build', 'build_actual'));
    assert.deepEqual(result.compileArgs, ['compile', '--profile', 'actual', '--build-property', 'build.extra_flags=-DTEST=1', '--build-path', result.buildPath, '--no-color', '--jobs', '0', f.sketch]);
});

test('explicit named profile is operation-local and overrides saved/default selections', (t) => {
    const f = fixture(t);
    const config = f.config({ compile_profile: 'release' });
    const yaml = f.yaml('profiles:\n  release:\n    fqbn: arduino:avr:uno\n    port: COM3\n  debug:\n    fqbn: arduino:avr:nano\n    port: COM4\ndefault_profile: release\n');
    const configBefore = fs.readFileSync(config, 'utf8');
    const yamlBefore = fs.readFileSync(yaml, 'utf8');
    const result = inspectProject({ sketchPath: f.sketch, profile: 'debug' }, f.sketch);
    assert.equal(result.canCompile, true);
    assert.equal(result.resolvedProfile, 'debug');
    assert.equal(result.selectedProfile, 'debug');
    assert.equal(result.port, 'COM4');
    assert.equal(fs.readFileSync(config, 'utf8'), configBefore);
    assert.equal(fs.readFileSync(yaml, 'utf8'), yamlBefore);
    assert.equal(inspectProject({ sketchPath: f.sketch }, f.sketch).resolvedProfile, 'release');
});

test('uses YAML default profile when no local selection exists, never guesses first', (t) => {
    const f = fixture(t);
    f.yaml('profiles:\n  one:\n    fqbn: arduino:avr:uno\n  two:\n    fqbn: arduino:avr:nano\ndefault_profile: two\n');
    assert.equal(inspectProject({ sketchPath: f.sketch }, f.sketch).resolvedProfile, 'two');
    f.yaml('profiles:\n  one:\n    fqbn: arduino:avr:uno\n  two:\n    fqbn: arduino:avr:nano\n');
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, false);
    assert.ok(result.issues.some((issue) => issue.code === 'PROFILE_REQUIRED'));
    assert.deepEqual(result.compileArgs, []);
});

test('missing metadata remains inspectable and reports compile blockers', (t) => {
    const f = fixture(t);
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, false);
    assert.equal(result.sketchName, 'Blink');
    assert.equal(result.buildPath, path.join(f.sketch, 'build'));
    assert.ok(result.issues.some((issue) => issue.code === 'FQBN_REQUIRED'));
    assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});

test('malformed JSON and YAML are reported without writes or parser-content disclosure', (t) => {
    const f = fixture(t);
    const secret = 'private-parse-content';
    const config = f.config(`{"${secret}":`);
    const yaml = f.yaml(`profiles: [\n${secret}`);
    const originalConfig = fs.readFileSync(config, 'utf8');
    const originalYaml = fs.readFileSync(yaml, 'utf8');
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, false);
    assert.ok(result.issues.some((issue) => issue.code === 'INVALID_CONFIGURATION'));
    assert.ok(result.issues.some((issue) => issue.code === 'INVALID_YAML'));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal(fs.readFileSync(config, 'utf8'), originalConfig);
    assert.equal(fs.readFileSync(yaml, 'utf8'), originalYaml);
    assert.equal(fs.existsSync(`${yaml}.disabled`), false);
});

test('requires a matching primary sketch and explicitly scoped active directory', (t) => {
    const f = fixture(t);
    const other = path.join(f.temporary, 'Other');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'Other.ino'), '');
    assert.throws(() => inspectProject({ sketchPath: other }, f.sketch), hasCode('OUT_OF_SCOPE'));
    assert.throws(() => inspectProject({ sketchPath: 'Blink' }, f.sketch), hasCode('INVALID_ARGUMENT'));
    fs.unlinkSync(path.join(f.sketch, 'Blink.ino'));
    assert.throws(() => inspectProject({ sketchPath: f.sketch }, f.sketch), hasCode('INVALID_SKETCH'));
});

test('rejects relative/absolute build escapes and sketch-root output', (t) => {
    const f = fixture(t);
    for (const output of ['../outside', f.temporary, '.']) {
        f.config({ board: 'arduino:avr:uno', output });
        assert.throws(() => inspectProject({ sketchPath: f.sketch }, f.sketch), hasCode('OUT_OF_SCOPE'));
    }
    f.config({ board: 'arduino:avr:uno', output: 'Blink.ino' });
    assert.throws(() => inspectProject({ sketchPath: f.sketch }, f.sketch), hasCode('INVALID_BUILD_PATH'));
});

test('rejects an output directory junction escaping the sketch, including missing descendants', (t) => {
    const f = fixture(t);
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    try {
        fs.symlinkSync(outside, path.join(f.sketch, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            t.skip('The environment does not permit directory links.');
            return;
        }
        throw error;
    }
    f.config({ board: 'arduino:avr:uno', output: 'linked/not-created-yet' });
    assert.throws(() => inspectProject({ sketchPath: f.sketch }, f.sketch), hasCode('OUT_OF_SCOPE'));
    assert.deepEqual(fs.readdirSync(outside), []);
});

test('rejects metadata junctions escaping the sketch', (t) => {
    const f = fixture(t);
    const outside = path.join(f.temporary, 'metadata');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'arduino.json'), '{"board":"arduino:avr:uno"}');
    try {
        fs.symlinkSync(outside, path.join(f.sketch, '.vscode'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            t.skip('The environment does not permit directory links.');
            return;
        }
        throw error;
    }
    assert.throws(() => inspectProject({ sketchPath: f.sketch }, f.sketch), hasCode('OUT_OF_SCOPE'));
});

test('validates explicit arguments, saved profile names and missing selections', (t) => {
    const f = fixture(t);
    for (const profile of ['../escape', '.', '..', 'a'.repeat(65), '-bad']) {
        assert.throws(() => inspectProject({ sketchPath: f.sketch, profile }, f.sketch), hasCode('INVALID_ARGUMENT'));
    }
    f.config({ compile_profile: 'default_profile' });
    f.yaml('profiles:\n  valid:\n    fqbn: arduino:avr:uno\ndefault_profile: ../escape\n');
    const badName = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(badName.canCompile, false);
    assert.ok(badName.issues.some((issue) => issue.code === 'INVALID_PROFILE'));
    const missing = inspectProject({ sketchPath: f.sketch, profile: 'missing' }, f.sketch);
    assert.equal(missing.canCompile, false);
    assert.ok(missing.issues.some((issue) => issue.code === 'PROFILE_NOT_FOUND'));
});

test('fingerprint is stable but changes for raw configuration, YAML, profile and clean changes', (t) => {
    const f = fixture(t);
    f.config({ compile_profile: 'one' });
    const initialYaml = 'profiles:\n  one:\n    fqbn: arduino:avr:uno\n    notes: private-notes\n  two:\n    fqbn: arduino:avr:nano\n';
    f.yaml(initialYaml);
    const initial = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, initial.fingerprint);
    assert.notEqual(inspectProject({ sketchPath: f.sketch, profile: 'two' }, f.sketch).fingerprint, initial.fingerprint);
    assert.notEqual(inspectProject({ sketchPath: f.sketch, clean: true }, f.sketch).fingerprint, initial.fingerprint);
    assert.ok(!JSON.stringify(initial).includes('private-notes'));
    f.yaml(`${initialYaml}# formatting changes are fingerprinted too\n`);
    assert.notEqual(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, initial.fingerprint);
    f.yaml(initialYaml);
    f.config({ compile_profile: 'one', board: 'arduino:avr:uno' });
    assert.notEqual(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, initial.fingerprint);
});

test('invalid selected profile data cannot produce executable compile arguments', (t) => {
    const f = fixture(t);
    f.yaml('profiles:\n  invalid:\n    fqbn: not-an-fqbn\n    build_properties: [42]\ndefault_profile: invalid\n');
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, false);
    assert.ok(result.issues.some((issue) => issue.code === 'INVALID_FQBN'));
    assert.ok(result.issues.some((issue) => issue.code === 'INVALID_BUILD_PROPERTIES'));
    assert.deepEqual(result.compileArgs, []);
});

test('source metadata changes fingerprint for nested and case-insensitive compile sources', (t) => {
    const f = fixture(t);
    f.config({ board: 'arduino:avr:uno' });
    const nested = path.join(f.sketch, 'src', 'build');
    fs.mkdirSync(nested, { recursive: true });
    const source = path.join(nested, 'helper.HPP');
    fs.writeFileSync(source, 'void helper();\n');
    fs.utimesSync(source, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
    const initial = inspectProject({ sketchPath: f.sketch }, f.sketch);
    fs.utimesSync(source, new Date('2025-01-02T00:00:00Z'), new Date('2025-01-02T00:00:00Z'));
    const changed = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(changed.canCompile, true);
    assert.notEqual(changed.fingerprint, initial.fingerprint);
    assert.equal(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, changed.fingerprint);
    fs.writeFileSync(path.join(nested, 'start.S'), '');
    assert.notEqual(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, changed.fingerprint);
});

test('additional Arduino source files are tracked through creation, edits and deletion', (t) => {
    const f = fixture(t);
    f.config({ board: 'arduino:avr:uno' });
    const baseline = inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint;
    for (const extension of ['hh', 'ipp', 'tpp', 'pde', 'HH', 'IpP', 'TPP', 'PDE']) {
        const source = path.join(f.sketch, `helper.${extension}`);
        fs.writeFileSync(source, 'before\n');
        const created = inspectProject({ sketchPath: f.sketch }, f.sketch);
        assert.equal(created.canCompile, true);
        assert.notEqual(created.fingerprint, baseline, `${extension} creation must change the fingerprint`);
        fs.appendFileSync(source, 'after\n');
        assert.notEqual(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, created.fingerprint,
            `${extension} edits must change the fingerprint`);
        fs.unlinkSync(source);
        assert.equal(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, baseline,
            `${extension} deletion must remove it from the fingerprint`);
    }
});

test('header edits during assistant preflight or compilation reject stale builds', async (t) => {
    const f = fixture(t);
    f.config({ board: 'arduino:avr:uno' });
    const source = path.join(f.sketch, 'helper.hh');
    fs.writeFileSync(source, 'before\n');
    let changeDuringPreflight = true;
    let compiles = 0;
    let invalidations = 0;
    const handler = createAiOperationHandler({
        isTrusted: () => true, activeSketchPath: () => f.sketch, isReady: () => true,
        inspect: inspectProject, cliInfo: () => ({ executable: 'simulated-arduino-cli', version: 'test' }),
        hasUnsavedSketchDocuments: () => false, revision: () => 0,
        compile: async target => {
            compiles++;
            fs.appendFileSync(source, 'changed during compilation\n');
            return {
                schemaVersion: 1, operationId: 'simulated-operation', target, status: 'success',
                exitCode: 0, stdout: '', stderr: '', durationMs: 1, truncated: false, cliVersion: 'test',
                ...unavailableCompileOutput('Simulated compile.'), artifacts: unavailableCompileArtifacts('Simulated compile.'),
            };
        },
        discover: async () => ({}), query: async () => ({}), invalidateBuild: () => { invalidations++; },
    });
    const compile = () => handler('compile_sketch', { sketchPath: f.sketch }, new AbortController().signal, () => {
        if (changeDuringPreflight) { fs.appendFileSync(source, 'changed during preflight\n'); }
    });
    await assert.rejects(compile(), hasCode('STALE_TARGET'));
    assert.equal(compiles, 0, 'a changed header must require fresh context before execution');

    changeDuringPreflight = false;
    const result = await compile() as AiOperationResult;
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'STALE_INPUT');
    assert.equal(compiles, 1);
    assert.equal(invalidations, 1, 'a header changed during compilation must invalidate its artifacts');
});

test('only current build output is excluded; old output directories become tracked sources', (t) => {
    const f = fixture(t);
    f.config({ board: 'arduino:avr:uno', output: 'previous-output' });
    const oldOutput = path.join(f.sketch, 'previous-output');
    fs.mkdirSync(oldOutput);
    const source = path.join(oldOutput, 'helper.cpp');
    fs.writeFileSync(source, 'void helper() {}\n');
    fs.utimesSync(source, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T00:00:00Z'));
    f.config({ board: 'arduino:avr:uno', output: 'current-output' });
    const initial = inspectProject({ sketchPath: f.sketch }, f.sketch);
    fs.utimesSync(source, new Date('2025-01-02T00:00:00Z'), new Date('2025-01-02T00:00:00Z'));
    assert.notEqual(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, initial.fingerprint);
});

test('generated sources inside actual build output and excluded metadata do not change fingerprint', (t) => {
    const f = fixture(t);
    f.config({ board: 'arduino:avr:uno', output: 'generated' });
    const initial = inspectProject({ sketchPath: f.sketch }, f.sketch);
    for (const directory of ['generated', '.git', '.vscode', 'node_modules']) {
        fs.mkdirSync(path.join(f.sketch, directory), { recursive: true });
        fs.writeFileSync(path.join(f.sketch, directory, 'helper.cpp'), 'generated\n');
    }
    assert.equal(inspectProject({ sketchPath: f.sketch }, f.sketch).fingerprint, initial.fingerprint);
});

test('rejects reserved source and metadata build outputs', (t) => {
    const f = fixture(t);
    for (const output of ['.git', '.vscode', 'node_modules', 'src', 'src/build', 'generated/.git/cache', 'generated/.vscode', 'generated/node_modules']) {
        f.config({ board: 'arduino:avr:uno', output });
        assert.throws(() => inspectProject({ sketchPath: f.sketch }, f.sketch), hasCode('INVALID_BUILD_PATH'));
    }
});

test('source directory links are not followed and produce a generic incomplete-scan issue', (t) => {
    const f = fixture(t);
    f.config({ board: 'arduino:avr:uno' });
    const outside = path.join(f.temporary, 'private-source');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.cpp'), 'private-source-content');
    try {
        fs.symlinkSync(outside, path.join(f.sketch, 'linked-source'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            t.skip('The environment does not permit directory links.');
            return;
        }
        throw error;
    }
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, false);
    assert.deepEqual(result.compileArgs, []);
    assert.ok(result.issues.some((issue) => issue.code === 'SOURCE_SCAN_INCOMPLETE'));
    assert.ok(!JSON.stringify(result).includes('private-source-content'));
});

test('profile summaries expose sorted names, selection and dependency declarations only', (t) => {
    const f = fixture(t);
    f.yaml(`profiles:
  release:
    fqbn: esp32:esp32:esp32
    notes: do-not-export-profile-notes
    build_properties: [build.secret=do-not-export-other-profile-property]
    platforms:
      - platform: esp32:esp32 (3.2.0)
        platform_index_url: https://example.test/package.json
      - platform: arduino:avr
    libraries:
      - Adafruit NeoPixel (1.12.3)
      - dependency: Adafruit BusIO (1.17.0)
      - dir: ../external-library
  debug:
    fqbn: arduino:avr:uno
default_profile: release
`);
    const result = inspectProject({ sketchPath: f.sketch, profile: 'debug' }, f.sketch);
    assert.equal(result.canCompile, true);
    assert.equal(result.defaultProfile, 'release');
    assert.deepEqual(result.availableProfiles, [
        { name: 'debug', fqbn: 'arduino:avr:uno', isDefault: false, isSelected: true,
            dependencies: { platforms: [], libraries: [], issues: [] }, issues: [] },
        { name: 'release', fqbn: 'esp32:esp32:esp32', isDefault: true, isSelected: false,
            dependencies: {
                platforms: [{ id: 'esp32:esp32', version: '3.2.0', indexUrl: 'https://example.test/package.json' }, { id: 'arduino:avr' }],
                libraries: [{ kind: 'index', name: 'Adafruit NeoPixel', version: '1.12.3' },
                    { kind: 'index', name: 'Adafruit BusIO', version: '1.17.0', transitive: true },
                    { kind: 'local', directory: '../external-library' }], issues: [],
            }, issues: [] },
    ]);
    assert.deepEqual(result.declaredDependencies, { platforms: [], libraries: [], issues: [] });
    assert.ok(!JSON.stringify(result).includes('do-not-export'));
    const defaultResult = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.deepEqual(defaultResult.declaredDependencies, result.availableProfiles[1].dependencies);
    assert.deepEqual(defaultResult.availableProfiles.map(profile => profile.isSelected), [false, true]);
});

test('missing metadata, missing profile selection and explicit unknown profile still expose declarations predictably', (t) => {
    const f = fixture(t);
    const missing = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.deepEqual(missing.availableProfiles, []);
    assert.deepEqual(missing.declaredDependencies, { platforms: [], libraries: [], issues: [] });
    assert.equal(missing.defaultProfile, undefined);
    f.yaml('profiles:\n  one:\n    fqbn: arduino:avr:uno\n    libraries: [Servo (1.2.2)]\n');
    for (const profile of [undefined, 'missing']) {
        const result = inspectProject({ sketchPath: f.sketch, ...(profile ? { profile } : {}) }, f.sketch);
        assert.equal(result.availableProfiles.length, 1);
        assert.equal(result.availableProfiles[0].isSelected, false);
        assert.deepEqual(result.declaredDependencies, { platforms: [], libraries: [], issues: [] });
        assert.equal(result.canCompile, false);
    }
});

test('dependency parsing is bounded, reports generic malformed declarations and never resolves local paths', (t) => {
    const f = fixture(t);
    const outside = path.join(f.temporary, 'missing-private-library');
    const profiles = {
        selected: { fqbn: 'arduino:avr:uno', libraries: [{ dir: outside }, 'Servo'], platforms: [{ platform: 'arduino:avr' }] },
        malformed: {
            fqbn: 'private-invalid-fqbn', platforms: [{ platform: 'private-invalid-platform' }, { platform: 'esp32:esp32', platform_index_url: 42 }],
            libraries: [42, { dependency: 42 }, { dir: 42 }, { dir: outside, dependency: 'private-ambiguous-library' }, 'private-malformed ('],
        },
        invalid: 'private-profile-contents',
    };
    f.yaml(JSON.stringify({ profiles, default_profile: 'selected' }));
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, true, 'unrelated malformed dependency metadata must not block the selected compile');
    assert.deepEqual(result.declaredDependencies, {
        platforms: [{ id: 'arduino:avr' }], libraries: [{ kind: 'local', directory: outside }, { kind: 'index', name: 'Servo' }], issues: [],
    });
    assert.equal(fs.existsSync(outside), false);
    const malformed = result.availableProfiles.find(profile => profile.name === 'malformed')!;
    assert.deepEqual(malformed.dependencies.issues.map(issue => issue.code), ['INVALID_PLATFORM_DEPENDENCY', 'INVALID_LIBRARY_DEPENDENCY']);
    assert.ok(malformed.issues.some(issue => issue.code === 'INVALID_FQBN'));
    assert.ok(result.availableProfiles.find(profile => profile.name === 'invalid')!.issues.some(issue => issue.code === 'INVALID_PROFILE'));
    for (const text of ['private-invalid', 'private-ambiguous', 'private-malformed', 'private-profile-contents']) {
        assert.ok(!JSON.stringify(result).includes(text));
    }
    f.yaml(JSON.stringify({ profiles: { selected: { fqbn: 'arduino:avr:uno', platforms: 'private-not-a-list', libraries: [{ dependency: 'Library ()' }] } }, default_profile: 'selected' }));
    const invalid = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(invalid.canCompile, true, 'dependency reporting does not alter existing compilation validation');
    assert.deepEqual(invalid.declaredDependencies.issues.map(issue => issue.code), ['INVALID_DEPENDENCIES', 'INVALID_LIBRARY_DEPENDENCY']);
    assert.ok(!JSON.stringify(invalid).includes('private-not-a-list'));
});

test('profile and dependency limits retain selected/default summaries and report truncation', (t) => {
    const f = fixture(t);
    const profiles: Record<string, unknown> = {};
    for (let index = 0; index < 105; index++) { profiles[`p${String(index).padStart(3, '0')}`] = { fqbn: 'arduino:avr:uno' }; }
    profiles.zSelected = { fqbn: 'arduino:avr:uno', libraries: Array.from({ length: 205 }, (_, index) => `Library ${index} (1.0.0)`) };
    profiles.zDefault = { fqbn: 'arduino:avr:uno' };
    profiles['invalid/name'] = { fqbn: 'arduino:avr:uno' };
    f.yaml(JSON.stringify({ profiles, default_profile: 'zDefault' }));
    const result = inspectProject({ sketchPath: f.sketch, profile: 'zSelected' }, f.sketch);
    assert.equal(result.canCompile, true);
    assert.equal(result.availableProfiles.length, 100);
    assert.equal(result.availableProfiles.find(profile => profile.isSelected)?.name, 'zSelected');
    assert.equal(result.availableProfiles.find(profile => profile.isDefault)?.name, 'zDefault');
    assert.deepEqual(result.availableProfiles.map(profile => profile.name), result.availableProfiles.map(profile => profile.name).sort());
    assert.equal(result.declaredDependencies.libraries.length, 200);
    assert.ok(result.declaredDependencies.issues.some(issue => issue.code === 'DEPENDENCY_LIST_TRUNCATED'));
    assert.equal(result.availableProfilesTruncated, true);
    assert.deepEqual(result.issues, []);
});

test('YAML alias expansion and cyclic declarations remain bounded without exporting parser contents', (t) => {
    const f = fixture(t);
    f.yaml('profiles:\n  one: &one\n    fqbn: arduino:avr:uno\n    libraries: [*one]\ndefault_profile: one\n');
    const cyclic = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(cyclic.canCompile, true);
    assert.ok(cyclic.declaredDependencies.issues.some(issue => issue.code === 'INVALID_LIBRARY_DEPENDENCY'));
    f.yaml(`private: &private [private-parser-content]\na: &a [${Array(20).fill('*private').join(', ')}]\nb: &b [${Array(20).fill('*a').join(', ')}]\nprofiles:\n  one:\n    fqbn: arduino:avr:uno\n    libraries: *b\ndefault_profile: one\n`);
    const expanded = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.ok(expanded.issues.some(issue => issue.code === 'INVALID_YAML'));
    assert.ok(!JSON.stringify(expanded).includes('private-parser-content'));
});

test('platform index URLs omit credentials and invalid URL metadata', (t) => {
    const f = fixture(t);
    f.yaml(JSON.stringify({ profiles: { selected: { fqbn: 'arduino:avr:uno', platforms: [
        { platform: 'arduino:avr', platform_index_url: 'https://private-user:private-password@example.test/package.json' },
        { platform: 'esp32:esp32', platform_index_url: 'private-invalid-url' },
    ] } }, default_profile: 'selected' }));
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.deepEqual(result.declaredDependencies.platforms, [
        { id: 'arduino:avr', indexUrl: 'https://example.test/package.json' }, { id: 'esp32:esp32' },
    ]);
    assert.ok(result.declaredDependencies.issues.some(issue => issue.code === 'INVALID_PLATFORM_DEPENDENCY'));
    assert.ok(!JSON.stringify(result).includes('private-'));
});

test('aggregate profile dependency metadata has a shared byte budget with explicit truncation', (t) => {
    const f = fixture(t);
    const profiles: Record<string, unknown> = {};
    const libraries = Array.from({ length: 200 }, (_, index) => `Library${index}`);
    const platforms = Array.from({ length: 200 }, () => ({ platform: 'arduino:avr' }));
    for (let index = 0; index < 100; index++) { profiles[`p${String(index).padStart(3, '0')}`] = { fqbn: 'arduino:avr:uno', libraries, platforms }; }
    const yaml = JSON.stringify({ profiles, default_profile: 'p099' });
    assert.ok(Buffer.byteLength(yaml) < 1024 * 1024, 'fixture must fit the existing metadata input limit');
    f.yaml(yaml);
    const result = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(result.canCompile, true);
    assert.equal(result.availableProfiles.length, 100);
    assert.deepEqual(result.availableProfiles.find(profile => profile.isSelected)?.dependencies, result.declaredDependencies,
        'selected profile receives the dependency budget first');
    assert.ok(result.availableProfiles.some(profile => profile.dependencies.issues.some(issue => issue.code === 'DEPENDENCY_METADATA_TRUNCATED')));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 512 * 1024, 'bounded summaries must fit comfortably inside the IPC response limit');

    f.yaml(JSON.stringify({ profiles: { selected: { fqbn: 'arduino:avr:uno', libraries: Array(200).fill('L'.repeat(4000)) } }, default_profile: 'selected' }));
    const longValues = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.ok(longValues.declaredDependencies.issues.some(issue => issue.code === 'DEPENDENCY_METADATA_TRUNCATED'));
    assert.ok(Buffer.byteLength(JSON.stringify(longValues)) < 512 * 1024, 'individual profile declarations also have a byte budget');
});
