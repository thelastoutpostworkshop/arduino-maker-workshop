import { test, type TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createBacktraceBuildRecord, decodeEsp32Backtrace } from '../backtrace';
import { AiBridgeError, type ProjectInspection } from '../contracts';
import { inspectProject } from '../projectInspection';
import * as decoder from '../../esp32Backtrace';

const LOG = 'PC : 0x40081234\nBacktrace: 0x40081234:0x3ffb1000 0x40085678:0x3ffb1020\n';
const signal = () => new AbortController().signal;

function makeElf(machine = 94): Buffer {
    const elf = Buffer.alloc(1024, 0x31);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]).copy(elf);
    elf.writeUInt16LE(2, 16);
    elf.writeUInt16LE(machine, 18);
    elf.writeUInt32LE(1, 20);
    elf.writeUInt16LE(52, 40);
    return elf;
}

function fixture(t: TestContext, options: { profiles?: boolean; machine?: number; board?: string } = {}) {
    const parent = fs.realpathSync.native(os.tmpdir());
    const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, 'amw-backtrace-')));
    const sketch = path.join(temporary, 'MySketch');
    const configuration = path.join(sketch, '.vscode', 'arduino.json');
    const fqbn = `esp32:esp32:${options.board ?? (options.machine === 243 ? 'esp32c3' : 'esp32')}`;
    fs.mkdirSync(path.dirname(configuration), { recursive: true });
    fs.writeFileSync(path.join(sketch, 'MySketch.ino'), 'void setup() {}\nvoid loop() {}\n');
    fs.writeFileSync(configuration, JSON.stringify({ board: fqbn }));
    if (options.profiles) {
        fs.writeFileSync(path.join(sketch, 'sketch.yaml'), `default_profile: release\nprofiles:\n  release:\n    fqbn: ${fqbn}\n  debug:\n    fqbn: ${fqbn}\n`);
    }
    const inspect = (profile?: string, clean?: boolean) => inspectProject({ sketchPath: sketch,
        ...(profile ? { profile } : {}), ...(clean ? { clean } : {}) }, sketch);
    const target = inspect();
    fs.mkdirSync(target.buildPath, { recursive: true });
    const elfPath = path.join(target.buildPath, 'MySketch.ino.elf');
    fs.writeFileSync(elfPath, makeElf(options.machine));
    const dataDir = path.join(temporary, 'Arduino15');
    const prefix = options.machine === 243 ? 'riscv32-esp-elf' : 'xtensa-esp-elf';
    const toolPath = path.join(dataDir, 'packages', 'esp32', 'tools', prefix, '1.0', 'bin', `${prefix}-addr2line${process.platform === 'win32' ? '.exe' : ''}`);
    fs.mkdirSync(path.dirname(toolPath), { recursive: true });
    fs.writeFileSync(toolPath, 'fixture decoder; execution is mocked');
    const calls: decoder.Addr2LineRequest[] = [];
    let execute: ((request: decoder.Addr2LineRequest) => Promise<Awaited<ReturnType<typeof decoder.runAddr2Line>>> | Awaited<ReturnType<typeof decoder.runAddr2Line>>) | undefined;
    const normalResult = () => ({ exitCode: 0, signal: null, stdout: 'decoded\n', stderr: '', output: 'decoded\n', truncated: false,
        canceled: false, durationMs: 4, frames: [
            { address: '0x40081234', functionName: 'crashingFunction()', file: path.join(sketch, 'MySketch.ino'), line: 12 },
            { address: '0x40085678', functionName: 'loop()', file: path.join(sketch, 'MySketch.ino'), line: 40 },
        ] });
    t.mock.method(decoder, 'runAddr2Line', async (request: decoder.Addr2LineRequest) => {
        calls.push(request);
        return execute ? execute(request) : normalResult();
    });
    t.after(() => {
        assert.equal(path.dirname(temporary), parent);
        assert.ok(path.basename(temporary).startsWith('amw-backtrace-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    const markerPath = path.join(target.buildPath, 'compile_result.json');
    const saveRecord = async (selected = target) => {
        const backtrace = await createBacktraceBuildRecord(selected);
        assert.ok(backtrace, 'A supported ordinary fixture ELF should produce a build record.');
        fs.writeFileSync(path.join(selected.buildPath, 'compile_result.json'), JSON.stringify({ result: true, fingerprint: selected.fingerprint, backtrace }));
        return backtrace;
    };
    return { temporary, sketch, configuration, inspect, target, elfPath, dataDir, toolPath, calls, markerPath, saveRecord, normalResult,
        onExecute: (callback: NonNullable<typeof execute>) => { execute = callback; },
        decode: (selected = target, log = LOG, requestSignal = signal()) => decodeEsp32Backtrace({ target: selected, log, dataDir, signal: requestSignal }) };
}

function code(expected: string) { return (error: unknown) => error instanceof AiBridgeError && error.code === expected; }

test('records a successful matching ELF and decodes functions, files and lines with the installed tool', async (t) => {
    const f = fixture(t);
    const record = await f.saveRecord();
    assert.equal(record.buildFingerprint, f.target.buildFingerprint);
    assert.equal(record.elf.architecture, 'xtensa');
    assert.match(record.elf.sha256, /^[0-9a-f]{64}$/);
    const result = await f.decode();
    assert.equal(result.status, 'success');
    assert.equal(result.elfPath, f.elfPath);
    assert.equal(result.decoderPath, f.toolPath);
    assert.equal(result.architecture, 'xtensa');
    assert.equal(result.frames[0].line, 12);
    assert.equal(result.frames[1].functionName, 'loop()');
    assert.deepEqual(f.calls[0].addresses, ['0x40081234', '0x40085678']);
    assert.match(result.notes.join(' '), /cannot verify.*currently running/);
});

test('ELF machine selects the RISC-V decoder', async (t) => {
    const f = fixture(t, { machine: 243 });
    await f.saveRecord();
    const result = await f.decode();
    assert.equal(result.architecture, 'riscv');
    assert.match(result.decoderPath, /riscv32-esp-elf/);
});

test('accepts the installed compiler cache used by isolated Arduino CLI profiles', async (t) => {
    const f = fixture(t, { profiles: true });
    await f.saveRecord();
    const directory = path.join(f.dataDir, 'internal', 'esp32_esp-x32_2601_0123456789abcdef', 'bin');
    fs.mkdirSync(directory, { recursive: true });
    const compiler = path.join(directory, path.basename(f.toolPath));
    fs.renameSync(f.toolPath, compiler);
    assert.equal((await f.decode()).decoderPath, compiler);
});

test('rejects arbitrary internal cache entries and linked isolated compiler caches', async (t) => {
    const f = fixture(t, { profiles: true });
    await f.saveRecord();
    const arbitrary = path.join(f.dataDir, 'internal', 'unrelated-package', 'bin', path.basename(f.toolPath));
    fs.mkdirSync(path.dirname(arbitrary), { recursive: true });
    fs.copyFileSync(f.toolPath, arbitrary);
    const found = t.mock.method(decoder, 'findAddr2LineBinary', () => arbitrary);
    await assert.rejects(f.decode(), code('UNSAFE_DECODER'));
    const allowed = path.join(f.dataDir, 'internal', 'esp32_esp-x32_2601_0123456789abcdef');
    fs.symlinkSync(path.join(f.dataDir, 'internal', 'unrelated-package'), allowed, 'junction');
    found.mock.mockImplementation(() => path.join(allowed, 'bin', path.basename(f.toolPath)));
    await assert.rejects(f.decode(), code('UNSAFE_DECODER'));
    assert.equal(f.calls.length, 0);
});

test('uses the requested profile output and never selects a newer ELF from another profile', async (t) => {
    const f = fixture(t, { profiles: true });
    await f.saveRecord();
    const other = f.inspect('debug');
    fs.mkdirSync(other.buildPath, { recursive: true });
    fs.writeFileSync(path.join(other.buildPath, 'MySketch.ino.elf'), makeElf());
    assert.equal((await f.decode()).target.profile, 'release');
    await assert.rejects(f.decode(other), code('BUILD_REQUIRED'));
    assert.equal(f.calls.length, 1);
});

test('accepts a clean explicit-profile build when the same profile is selected implicitly afterward', async (t) => {
    const f = fixture(t, { profiles: true });
    const compiled = f.inspect('release', true);
    assert.notEqual(compiled.fingerprint, f.target.fingerprint);
    assert.equal(compiled.buildFingerprint, f.target.buildFingerprint);
    await f.saveRecord(compiled);
    assert.equal((await f.decode()).status, 'success');
});

test('keeps inline frames and preserves unknown addresses in requested order', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    f.onExecute(() => ({ ...f.normalResult(), frames: [
        { address: '0x40085678', functionName: 'inlineHelper()', file: 'driver.cpp', line: 10 },
        { address: '0x40085678', functionName: 'loop()', file: 'MySketch.ino', line: 40 },
        { address: '0x12345678', functionName: 'notRequested()', file: 'unrelated.cpp', line: 1 },
    ] }));
    const result = await f.decode();
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.frames.map(frame => frame.address), ['0x40081234', '0x40085678', '0x40085678']);
    assert.equal(result.frames[0].functionName, '??');
    assert.match(result.notes.join(' '), /unknown frames were preserved/);
});

test('reports bounded decoder output and address truncation explicitly', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    f.onExecute(() => ({ ...f.normalResult(), truncated: true }));
    const result = await f.decode();
    assert.equal(result.status, 'partial');
    assert.equal(result.truncated, true);
    assert.match(result.notes.join(' '), /Decoder output exceeded/);
    const log = `Backtrace: ${Array.from({ length: 140 }, (_, index) => `0x${(0x40080000 + index).toString(16)}:0x3ffb1000`).join(' ')}`;
    const bounded = await f.decode(f.target, log);
    assert.ok(f.calls.at(-1)!.addresses.length <= 128);
    assert.match(bounded.notes.join(' '), /address limit/);
});

test('rejects non-ESP32 targets and logs without supported instruction addresses before executing', async (t) => {
    const f = fixture(t);
    await assert.rejects(f.decode({ ...f.target, fqbn: 'arduino:avr:uno' }), code('UNSUPPORTED_TARGET'));
    await assert.rejects(f.decode(f.target, 'heap pointer 0x40081234'), code('NO_BACKTRACE_ADDRESSES'));
    for (const log of ['', '\0', 'x'.repeat(65537)]) { await assert.rejects(f.decode(f.target, log), code('INVALID_ARGUMENT')); }
    assert.equal(f.calls.length, 0);
});

test('requires a successful recorded assistant build instead of accepting a manual marker or nearby ELF', async (t) => {
    const f = fixture(t);
    for (const marker of [undefined, '{', JSON.stringify({ result: true }), JSON.stringify({ result: false }), ' '.repeat(65537)]) {
        if (marker !== undefined) { fs.writeFileSync(f.markerPath, marker); }
        await assert.rejects(f.decode(), code('BUILD_REQUIRED'));
    }
    assert.equal(f.calls.length, 0);
});

test('rejects a stale source fingerprint, selected board, or profile even if the ELF still exists', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    fs.appendFileSync(path.join(f.sketch, 'MySketch.ino'), '// source changed\n');
    await assert.rejects(f.decode(f.inspect()), code('STALE_BUILD'));
    await assert.rejects(f.decode({ ...f.target, fqbn: 'esp32:esp32:esp32s3' }), code('STALE_BUILD'));
    await assert.rejects(f.decode({ ...f.target, resolvedProfile: 'other' }), code('STALE_BUILD'));
    assert.equal(f.calls.length, 0);
});

test('does not guess an unrelated ELF or choose among ambiguous matching names', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    fs.renameSync(f.elfPath, path.join(f.target.buildPath, 'another-sketch.ino.elf'));
    await assert.rejects(f.decode(), code('ELF_NOT_FOUND'));
    assert.equal(await createBacktraceBuildRecord(f.target), undefined);
    fs.writeFileSync(f.elfPath, makeElf());
    fs.writeFileSync(path.join(f.target.buildPath, 'MySketch.pde.elf'), makeElf());
    await assert.rejects(f.decode(), code('AMBIGUOUS_ELF'));
    assert.equal(await createBacktraceBuildRecord(f.target), undefined);
    assert.equal(f.calls.length, 0);
});

test('rejects unsupported or malformed ELF headers and oversized artifacts without failing compilation capture', async (t) => {
    const f = fixture(t);
    for (const modify of [
        (elf: Buffer) => { elf[0] = 0; },
        (elf: Buffer) => { elf[4] = 2; },
        (elf: Buffer) => { elf[5] = 2; },
        (elf: Buffer) => { elf.writeUInt16LE(3, 16); },
        (elf: Buffer) => { elf.writeUInt16LE(62, 18); },
        (elf: Buffer) => { elf.writeUInt16LE(0, 40); },
    ]) {
        const elf = makeElf(); modify(elf); fs.writeFileSync(f.elfPath, elf);
        assert.equal(await createBacktraceBuildRecord(f.target), undefined);
    }
    fs.truncateSync(f.elfPath, 128 * 1024 * 1024 + 1);
    assert.equal(await createBacktraceBuildRecord(f.target), undefined);
});

test('rejects an ELF whose architecture conflicts with a known board variant', async (t) => {
    const f = fixture(t, { machine: 243, board: 'esp32s3' });
    assert.equal(await createBacktraceBuildRecord(f.target), undefined);
});

test('hash binding rejects changed ELF contents even when the record has current file metadata', async (t) => {
    const f = fixture(t);
    const original = await f.saveRecord();
    const changed = makeElf(); changed[100] = 0x55;
    fs.writeFileSync(f.elfPath, changed);
    const current = await createBacktraceBuildRecord(f.target);
    assert.ok(current);
    current.elf.sha256 = original.elf.sha256;
    fs.writeFileSync(f.markerPath, JSON.stringify({ result: true, fingerprint: f.target.fingerprint, backtrace: current }));
    await assert.rejects(f.decode(), code('STALE_BUILD'));
    assert.equal(f.calls.length, 0);
});

test('rejects linked build directories, linked ELF candidates, and linked build markers', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    const outside = path.join(f.temporary, 'outside');
    fs.mkdirSync(outside);
    fs.renameSync(f.elfPath, path.join(outside, 'MySketch.ino.elf'));
    fs.symlinkSync(outside, f.elfPath, 'junction');
    await assert.rejects(f.decode(), code('UNSAFE_ELF'));
    assert.equal(await createBacktraceBuildRecord(f.target), undefined);
    fs.unlinkSync(f.elfPath);
    fs.renameSync(path.join(outside, 'MySketch.ino.elf'), f.elfPath);
    fs.unlinkSync(f.markerPath);
    fs.symlinkSync(outside, f.markerPath, 'junction');
    await assert.rejects(f.decode(), code('BUILD_REQUIRED'));
    fs.unlinkSync(f.markerPath);
    fs.renameSync(f.target.buildPath, `${f.target.buildPath}-original`);
    fs.symlinkSync(outside, f.target.buildPath, 'junction');
    assert.equal(await createBacktraceBuildRecord(f.target), undefined);
    await assert.rejects(f.decode(), code('BUILD_REQUIRED'));
    assert.equal(f.calls.length, 0);
});

test('withholds decoded frames if the ELF or successful marker changes during decoder execution', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    f.onExecute(() => { fs.appendFileSync(f.elfPath, 'changed'); return f.normalResult(); });
    await assert.rejects(f.decode(), code('STALE_BUILD'));
    await f.saveRecord();
    f.onExecute(() => { fs.writeFileSync(f.markerPath, JSON.stringify({ result: false })); return f.normalResult(); });
    await assert.rejects(f.decode(), code('BUILD_REQUIRED'));
});

test('rejects a replaced ordinary build directory even when its ELF and marker are moved intact', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    const previous = `${f.target.buildPath}-previous`;
    fs.renameSync(f.target.buildPath, previous);
    fs.mkdirSync(f.target.buildPath);
    fs.renameSync(path.join(previous, path.basename(f.elfPath)), f.elfPath);
    fs.renameSync(path.join(previous, path.basename(f.markerPath)), f.markerPath);
    await assert.rejects(f.decode(), code('STALE_BUILD'));
    assert.equal(f.calls.length, 0);
});

test('rejects changed decoder executables and decoders outside the installed ESP32 tools root', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    f.onExecute(() => { fs.appendFileSync(f.toolPath, 'changed'); return f.normalResult(); });
    await assert.rejects(f.decode(), code('STALE_BUILD'));
    const outside = path.join(f.temporary, 'untrusted-addr2line.exe');
    fs.writeFileSync(outside, 'outside');
    t.mock.method(decoder, 'findAddr2LineBinary', () => outside);
    await assert.rejects(f.decode(), code('UNSAFE_DECODER'));
    assert.equal(f.calls.length, 1);
});

test('rejects a linked package ancestor even when a tool search returns its canonical candidate', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    const packageDir = path.join(f.dataDir, 'packages');
    const moved = `${packageDir}-original`;
    fs.renameSync(packageDir, moved);
    fs.symlinkSync(moved, packageDir, 'junction');
    // A malicious/racing search result must not bypass ancestor validation.
    t.mock.method(decoder, 'findAddr2LineBinary', () => f.toolPath);
    await assert.rejects(f.decode(), code('UNSAFE_DECODER'));
    assert.equal(f.calls.length, 0);
});

test('reports unavailable installed decoders and process failures without returning frames', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    fs.renameSync(f.toolPath, `${f.toolPath}.disabled`);
    await assert.rejects(f.decode(), code('DECODER_NOT_FOUND'));
    fs.renameSync(`${f.toolPath}.disabled`, f.toolPath);
    f.onExecute(() => ({ ...f.normalResult(), exitCode: 1, stderr: 'bad elf' }));
    await assert.rejects(f.decode(), code('DECODER_FAILED'));
    f.onExecute(() => ({ ...f.normalResult(), error: { code: 'ENOENT', message: 'tool vanished' } }));
    await assert.rejects(f.decode(), code('DECODER_FAILED'));
});

test('honors cancellation before execution and while the decoder is running', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.decode(f.target, LOG, controller.signal), code('CANCELED'));
    assert.equal(f.calls.length, 0);
    const running = new AbortController();
    f.onExecute(() => { running.abort(); return { ...f.normalResult(), canceled: true }; });
    await assert.rejects(f.decode(f.target, LOG, running.signal), code('CANCELED'));
});

test('passes sensitive values to the bounded decoder process and does not provide raw log as executable arguments', async (t) => {
    const f = fixture(t);
    await f.saveRecord();
    await decodeEsp32Backtrace({ target: f.target, dataDir: f.dataDir, signal: signal(), log: `${LOG}\n--command dangerous; token=secret`, sensitiveValues: ['secret'] });
    assert.deepEqual(f.calls[0].sensitiveValues, ['secret']);
    assert.deepEqual(f.calls[0].addresses, ['0x40081234', '0x40085678']);
    assert.ok(!JSON.stringify(f.calls[0]).includes('dangerous'));
});
