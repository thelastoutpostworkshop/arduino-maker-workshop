import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectCompileArtifacts, snapshotCompileArtifacts, unavailableCompileArtifacts } from '../compileArtifacts';
import { inspectProject } from '../projectInspection';

function fixture(t: { after: (fn: () => void) => void }, profile = false) {
    const parent = fs.realpathSync.native(os.tmpdir());
    const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, 'amw-artifacts-')));
    const sketch = path.join(temporary, 'MySketch');
    fs.mkdirSync(path.join(sketch, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(sketch, 'MySketch.ino'), 'void setup() {}\nvoid loop() {}\n');
    fs.writeFileSync(path.join(sketch, '.vscode', 'arduino.json'), JSON.stringify({ board: 'arduino:avr:uno' }));
    if (profile) {
        fs.writeFileSync(path.join(sketch, 'sketch.yaml'), 'profiles:\n  release:\n    fqbn: arduino:avr:uno\n  debug:\n    fqbn: arduino:avr:uno\n');
    }
    const target = inspectProject({ sketchPath: sketch, ...(profile ? { profile: 'release' } : {}) }, sketch);
    t.after(() => {
        assert.equal(path.dirname(temporary), parent);
        assert.ok(path.basename(temporary).startsWith('amw-artifacts-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    return {
        temporary, sketch, target,
        write(name: string, contents = 'firmware') {
            const file = path.join(target.buildPath, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, contents);
            return file;
        },
    };
}

test('reports new final firmware and debug artifacts and excludes unrelated files and nested caches', async (t) => {
    const f = fixture(t);
    const snapshot = await snapshotCompileArtifacts(f.target);
    assert.equal(snapshot.complete, true);
    const allowed = ['MySketch.ino.elf', 'MySketch.ino.bin', 'MySketch.ino.with_bootloader.hex', 'MySketch.uf2', 'MySketch.ino.elf.map', 'MySketch.ino.eep', 'bootloader.bin', 'partitions.bin', 'boot_app0.bin'];
    for (const name of allowed) { f.write(name); }
    for (const name of ['different-sketch.ino.bin', 'MySketch.ino.bin.tmp', 'MySketch.ino.o', 'MySketch.ino.d', 'compile_result.json', 'build.options.json', 'sketch/MySketch.ino.elf', 'libraries/MySketch.bin']) {
        f.write(name);
    }
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.files.map(file => file.relativePath).sort(), allowed.sort());
    for (const file of report.files) {
        assert.equal(file.path, path.join(f.target.buildPath, file.relativePath));
        assert.equal(file.sizeBytes, Buffer.byteLength('firmware'));
        assert.equal(file.kind, path.extname(file.relativePath).slice(1));
    }
});

test('uses only the selected profile output directory', async (t) => {
    const f = fixture(t, true);
    const snapshot = await snapshotCompileArtifacts(f.target);
    assert.equal(f.target.buildPath, path.join(f.sketch, 'build', 'build_release'));
    f.write('MySketch.ino.elf');
    const other = path.join(f.sketch, 'build', 'build_debug');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'MySketch.ino.bin'), 'other profile');
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.deepEqual(report.files.map(file => file.path), [path.join(f.target.buildPath, 'MySketch.ino.elf')]);
});

test('omits unchanged cached artifacts while reporting changed and new outputs', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.elf', 'cached elf');
    f.write('MySketch.ino.bin', 'old');
    const snapshot = await snapshotCompileArtifacts(f.target);
    f.write('MySketch.ino.bin', 'new firmware with different length');
    f.write('MySketch.ino.hex', 'new hex');
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.files.map(file => file.relativePath), ['MySketch.ino.bin', 'MySketch.ino.hex']);
    assert.match(report.notes.join(' '), /Unchanged cached output/);
});

test('does not claim that unchanged incremental output belongs to the current build', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.elf');
    const snapshot = await snapshotCompileArtifacts(f.target);
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.files, []);
    assert.match(report.notes.join(' '), /could not be verified as newly produced/);
});

test('recognizes rewritten output with the same size from its modification time', async (t) => {
    const f = fixture(t);
    const file = f.write('MySketch.ino.bin', 'old');
    fs.utimesSync(file, new Date(10000), new Date(10000));
    const snapshot = await snapshotCompileArtifacts(f.target);
    f.write('MySketch.ino.bin', 'new');
    fs.utimesSync(file, new Date(20000), new Date(20000));
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.files.map(value => value.sizeBytes), [3]);
});

test('does not use metadata-only ctime changes as evidence of rewritten firmware', async (t) => {
    const f = fixture(t);
    const file = f.write('MySketch.ino.bin');
    fs.utimesSync(file, new Date(10000), new Date(10000));
    const snapshot = await snapshotCompileArtifacts(f.target);
    fs.utimesSync(file, new Date(20000), new Date(10000));
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.files, []);
});

test('withholds artifacts if the inspected target or profile changes', async (t) => {
    const f = fixture(t);
    const snapshot = await snapshotCompileArtifacts(f.target);
    f.write('MySketch.ino.bin');
    const report = await collectCompileArtifacts({ ...f.target, fingerprint: 'changed-target' }, snapshot);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.files, []);
    assert.match(report.notes.join(' '), /target changed/);
});

test('reports current artifacts when a clean build recreates its ordinary output directory', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.bin', 'old output');
    const target = inspectProject({ sketchPath: f.sketch, clean: true }, f.sketch);
    assert.ok(target.compileArgs.includes('--clean'));
    const snapshot = await snapshotCompileArtifacts(target);
    fs.renameSync(f.target.buildPath, `${f.target.buildPath}-old`);
    f.write('MySketch.ino.bin', 'replacement output');
    const report = await collectCompileArtifacts(target, snapshot);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.files.map(file => file.relativePath), ['MySketch.ino.bin']);
    assert.equal(report.files[0].sizeBytes, Buffer.byteLength('replacement output'));
});

test('reports outputs recreated for changed build options even when file metadata is preserved', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.bin', 'previous output');
    fs.writeFileSync(path.join(f.sketch, '.vscode', 'arduino.json'), JSON.stringify({ board: 'arduino:avr:nano', configuration: 'cpu=atmega328' }));
    const target = inspectProject({ sketchPath: f.sketch }, f.sketch);
    assert.equal(target.fqbn, 'arduino:avr:nano:cpu=atmega328');
    assert.ok(!target.compileArgs.includes('--clean'));
    const snapshot = await snapshotCompileArtifacts(target);
    const oldBuildPath = `${target.buildPath}-old`;
    fs.renameSync(target.buildPath, oldBuildPath);
    fs.mkdirSync(target.buildPath);
    // Moving the artifact retains even its identity and timestamps. The containing output is new.
    fs.renameSync(path.join(oldBuildPath, 'MySketch.ino.bin'), path.join(target.buildPath, 'MySketch.ino.bin'));
    const report = await collectCompileArtifacts(target, snapshot);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.files.map(file => file.relativePath), ['MySketch.ino.bin']);
});

test('rejects build roots outside the inspected sketch and oversized paths', async (t) => {
    const f = fixture(t);
    for (const buildPath of [f.temporary, f.sketch, path.join(f.sketch, 'a'.repeat(5000))]) {
        const target = { ...f.target, buildPath };
        const snapshot = await snapshotCompileArtifacts(target);
        assert.equal(snapshot.complete, false);
        assert.deepEqual((await collectCompileArtifacts(target, snapshot)).files, []);
    }
});

test('rejects junction or symbolic-link build roots and not-yet-created output beneath them', async (t) => {
    const f = fixture(t);
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'MySketch.ino.bin'), 'outside firmware');
    fs.symlinkSync(outside, f.target.buildPath, 'junction');
    for (const buildPath of [f.target.buildPath, path.join(f.target.buildPath, 'missing')]) {
        const target = { ...f.target, buildPath };
        const snapshot = await snapshotCompileArtifacts(target);
        assert.equal(snapshot.complete, false);
        const report = await collectCompileArtifacts(target, snapshot);
        assert.equal(report.status, 'unavailable');
        assert.deepEqual(report.files, []);
        assert.ok(!JSON.stringify(report).includes('outside firmware'));
    }
});

test('rejects a build directory replaced with an outside junction after the snapshot', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.bin');
    const snapshot = await snapshotCompileArtifacts(f.target);
    fs.renameSync(f.target.buildPath, `${f.target.buildPath}-old`);
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'MySketch.ino.bin'), 'outside firmware');
    fs.symlinkSync(outside, f.target.buildPath, 'junction');
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.files, []);
});

test('excludes linked artifact candidates while preserving verified ordinary outputs', async (t) => {
    const f = fixture(t);
    const snapshot = await snapshotCompileArtifacts(f.target);
    f.write('MySketch.ino.elf');
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.target.buildPath, 'MySketch.ino.bin'), 'junction');
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'partial');
    assert.deepEqual(report.files.map(file => file.relativePath), ['MySketch.ino.elf']);
    assert.match(report.notes.join(' '), /Linked artifact files/);
});

test('withholds output when the pre-build snapshot was incomplete', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.elf');
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.target.buildPath, 'MySketch.ino.bin'), 'junction');
    const snapshot = await snapshotCompileArtifacts(f.target);
    assert.equal(snapshot.complete, false);
    f.write('MySketch.ino.hex');
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.files, []);
    assert.match(report.notes.join(' '), /pre-build output snapshot was incomplete/);
    assert.match(report.notes.join(' '), /Linked artifact files/);
});

test('fails closed if the build root is replaced while its directory is being opened', async (t) => {
    const f = fixture(t);
    f.write('MySketch.ino.bin');
    const snapshot = await snapshotCompileArtifacts(f.target);
    const original = fs.promises.opendir;
    t.mock.method(fs.promises, 'opendir', async (directory: fs.PathLike) => {
        const handle = await original(directory);
        if (directory === f.target.buildPath) {
            fs.renameSync(f.target.buildPath, `${f.target.buildPath}-replaced`);
            f.write('MySketch.ino.bin', 'different output');
        }
        return handle;
    });
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.files, []);
});

test('reports unreadable artifact metadata as partial and never returns that file', async (t) => {
    const f = fixture(t);
    const snapshot = await snapshotCompileArtifacts(f.target);
    f.write('MySketch.ino.elf');
    const unreadable = f.write('MySketch.ino.bin');
    const original = fs.promises.realpath;
    t.mock.method(fs.promises, 'realpath', async (file: fs.PathLike) => {
        if (file === unreadable) { throw Object.assign(new Error('Access denied'), { code: 'EACCES' }); }
        return original(file);
    });
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'partial');
    assert.deepEqual(report.files.map(file => file.relativePath), ['MySketch.ino.elf']);
    assert.match(report.notes.join(' '), /metadata could not be inspected safely/);
});

test('limits the artifact count and reports partial post-build inspection', async (t) => {
    const f = fixture(t);
    const snapshot = await snapshotCompileArtifacts(f.target);
    for (let index = 0; index < 65; index++) { f.write(`MySketch.part${index}.bin`); }
    const report = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(report.status, 'partial');
    assert.equal(report.files.length, 64);
    assert.match(report.notes.join(' '), /file limit/);
});

test('bounds directory traversal even when files are not artifact candidates', async (t) => {
    const f = fixture(t);
    fs.mkdirSync(f.target.buildPath);
    for (let index = 0; index < 4097; index++) {
        fs.writeFileSync(path.join(f.target.buildPath, `unrelated${index}.txt`), '');
    }
    const snapshot = await snapshotCompileArtifacts(f.target);
    assert.equal(snapshot.complete, false);
    assert.match(snapshot.notes.join(' '), /directory-entry limit/);
    assert.equal((await collectCompileArtifacts(f.target, snapshot)).status, 'unavailable');
});

test('reports missing or non-directory build output as unavailable', async (t) => {
    const f = fixture(t);
    const snapshot = await snapshotCompileArtifacts(f.target);
    const missing = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(missing.status, 'unavailable');
    assert.match(missing.notes.join(' '), /directory is unavailable/);
    fs.writeFileSync(f.target.buildPath, 'not a directory');
    const invalid = await collectCompileArtifacts(f.target, snapshot);
    assert.equal(invalid.status, 'unavailable');
    assert.deepEqual(invalid.files, []);
});

test('unavailable reports contain no paths or files for failed, canceled, or stale builds', () => {
    for (const reason of ['Compilation failed.', 'Compilation was canceled.', 'The sketch changed during compilation.']) {
        assert.deepEqual(unavailableCompileArtifacts(reason), { status: 'unavailable', files: [], notes: [reason] });
    }
    assert.equal(unavailableCompileArtifacts('x'.repeat(5000)).notes[0].length, 2048);
});
