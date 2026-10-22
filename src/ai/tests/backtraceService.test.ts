import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test, type TestContext } from 'node:test';
import * as ts from 'typescript';
import * as backtrace from '../../esp32Backtrace';
import type { ProcessOptions, ProcessResult } from '../processRunner';

function temporaryDirectory(t: TestContext): string {
    const root = fs.realpathSync.native(path.resolve(__dirname, '../..'));
    const temporary = fs.mkdtempSync(path.join(root, 'amw-backtrace-service-'));
    t.after(() => {
        assert.equal(path.dirname(temporary), root);
        assert.ok(path.basename(temporary).startsWith('amw-backtrace-service-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    return temporary;
}

function loadSource(filename: string, dependencies: Record<string, unknown>): Record<string, any> {
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const module = { exports: {} };
    const load = vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename });
    load((id: string) => {
        if (Object.prototype.hasOwnProperty.call(dependencies, id)) { return dependencies[id]; }
        if (['node:fs', 'node:os', 'node:path', 'fs', 'os', 'path'].includes(id)) { return require(id); }
        throw new Error(`Unexpected module: ${id}`);
    }, module, module.exports);
    return module.exports;
}

const processResult = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
    exitCode: 0, signal: null, stdout: '', stderr: '', output: '', truncated: false,
    canceled: false, durationMs: 1, ...overrides
});

test('extracts Xtensa PC and backtrace instructions while excluding stack pointers and unrelated hex', () => {
    const parsed = backtrace.extractBacktraceAddresses([
        'Core 0 register dump:',
        'PC      : 0x400D1234  PS : 0x00060430  A0 : 0x800d4321',
        'Backtrace: 0x400D1234:0x3ffb1230 0x400d4567:0x3ffb1250',
        ' 0x400d4567:0x3ffb1260 0x400d7890:0x3ffb1290',
        'ELF file SHA256: 0123456789abcdef',
        'Saved register: 0x400dabcd:0x3ffb1230'
    ].join('\n'));
    assert.deepEqual(parsed, { pc: '0x400d1234', addresses: ['0x400d1234', '0x400d4567', '0x400d7890'] });
    assert.deepEqual(backtrace.extractBacktraceAddresses('\x1b[31mPC\x1b[0m : \x1b[1m0x400d1234\x1b[0m'), { pc: '0x400d1234', addresses: [] });
});

test('extracts RISC-V MEPC without interpreting a Stack memory dump as instruction addresses', () => {
    assert.deepEqual(backtrace.extractBacktraceAddresses([
        'MEPC    : 0x42001234 RA : 0x42005678',
        'Stack memory:',
        '0x3fc90000:0x42009999',
        '0x3fc90010: 0x42008888 0x00000000 0x00000000',
    ].join('\n')), { pc: '0x42001234', addresses: [] });
    assert.deepEqual(backtrace.extractBacktraceAddresses('PC : 0x00000000'), { pc: '0x00000000', addresses: [] });
    assert.deepEqual(backtrace.extractBacktraceAddresses('MEPC : 0x100000000\nBacktrace: 0x100000000:0x3fc00000'), { pc: undefined, addresses: [] });
});

test('bounds the log and total instruction addresses including a separate program counter', () => {
    const pairs = Array.from({ length: 150 }, (_, index) => `0x${(0x40000000 + index).toString(16)}:0x3ffb0000`);
    const parsed = backtrace.extractBacktraceAddresses(`PC: 0x42001234\nBacktrace: ${pairs.join(' ')}`);
    assert.equal(parsed.addresses.length + 1, backtrace.MAX_BACKTRACE_ADDRESSES);
    assert.equal(parsed.truncated, true);
    const tooLong = backtrace.extractBacktraceAddresses('x'.repeat(backtrace.MAX_BACKTRACE_LOG_BYTES) + '\nPC: 0x42001234');
    assert.equal(tooLong.pc, undefined);
    assert.equal(tooLong.truncated, true);
});

test('parses address-bearing pretty output, Windows paths, inline frames and unresolved frames', () => {
    assert.deepEqual(backtrace.parseAddr2LineOutput([
        '0x00000000400d1234: fail(int) at C:\\sketch with spaces\\sketch.ino:12',
        ' (inlined by) loop() at C:\\sketch with spaces\\sketch.ino:20 (discriminator 2)',
        '0x400d9999: ?? at ??:0',
        '0x42005678: task(void*) at /home/user/project/main.cpp:48',
    ].join('\n')), [
        { address: '0x400d1234', functionName: 'fail(int)', file: 'C:\\sketch with spaces\\sketch.ino', line: 12 },
        { address: '0x400d1234', functionName: 'loop()', file: 'C:\\sketch with spaces\\sketch.ino', line: 20 },
        { address: '0x400d9999', functionName: '??', file: '??', line: 0 },
        { address: '0x42005678', functionName: 'task(void*)', file: '/home/user/project/main.cpp', line: 48 },
    ]);
    assert.deepEqual(backtrace.parseAddr2LineOutput('0x42001234\nsetup()\n/project/sketch.ino:9\n??\n??:0'), [
        { address: '0x42001234', functionName: 'setup()', file: '/project/sketch.ino', line: 9 },
        { address: '0x42001234', functionName: '??', file: '??', line: 0 },
    ]);
});

test('shared runner supplies fixed non-shell flags, bounded output, cancellation, and preserves process failures', async () => {
    const calls: { executable: string; args: string[]; options: ProcessOptions }[] = [];
    let reply = processResult({ stdout: '0x400d1234: setup() at sketch.ino:7\n' });
    const service = loadSource(path.resolve(__dirname, '../../../src/esp32Backtrace.ts'), {
        './ai/processRunner': { runProcess: async (executable: string, args: string[], options: ProcessOptions) => {
            calls.push({ executable, args, options });
            return reply;
        } },
    });
    const signal = new AbortController().signal;
    const result = await service.runAddr2Line({ addr2linePath: '/tool with spaces/addr2line', elfPath: '/build/sketch.elf', pc: '0x400d1234', addresses: ['0x400d1234', '0x400d2222'], signal });
    assert.deepEqual(calls[0].args, ['-a', '-f', '-C', '-i', '-p', '-e', '/build/sketch.elf', '0x400d1234', '0x400d2222']);
    assert.equal(calls[0].options.signal, signal);
    assert.equal(calls[0].options.maxOutputBytes, 128 * 1024);
    assert.equal(result.frames[0].line, 7);
    reply = processResult({ exitCode: 2, stderr: 'bad ELF', canceled: true, truncated: true });
    const failed = await service.runAddr2Line({ addr2linePath: '/tool', elfPath: '/file', addresses: ['0x400d1234'] });
    assert.equal(failed.exitCode, 2);
    assert.equal(failed.stderr, 'bad ELF');
    assert.equal(failed.canceled, true);
    assert.equal(failed.truncated, true);
    reply = processResult({ stdout: '0x400d1234: f() at file.cpp:1\n' + '(inlined by) f() at file.cpp:2\n'.repeat(1030) });
    const manyFrames = await service.runAddr2Line({ addr2linePath: '/tool', elfPath: '/file', addresses: ['0x400d1234'] });
    assert.equal(manyFrames.frames.length, 1024);
    assert.equal(manyFrames.truncated, true);
    for (const addresses of [[], ['--help'], ['0x100000000'], Array.from({ length: 129 }, (_, i) => `0x${(i + 1).toString(16)}`)]) {
        await assert.rejects(service.runAddr2Line({ addr2linePath: '/tool', elfPath: '/file', addresses }), /valid 32-bit/);
    }
    assert.equal(calls.length, 3);
});

test('finds architecture-compatible tools, preferring exact chip over generic and skipping other chips', t => {
    const temporary = temporaryDirectory(t);
    const suffix = os.platform() === 'win32' ? '.exe' : '';
    const addTool = (folder: string, name: string, mtime: number) => {
        const filename = path.join(temporary, 'packages', 'esp32', 'tools', folder, '1.0', 'bin', name + suffix);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, 'fixture');
        fs.utimesSync(filename, mtime, mtime);
        return fs.realpathSync(filename);
    };
    const original = addTool('esp32', 'xtensa-esp32-elf-addr2line', 100);
    assert.equal(backtrace.findAddr2LineBinary(temporary, 'esp32s3', 'xtensa'), undefined);
    const generic = addTool('new', 'xtensa-esp-elf-addr2line', 200);
    const s3 = addTool('s3', 'xtensa-esp32s3-elf-addr2line', 100);
    const riscv = addTool('riscv', 'riscv32-esp-elf-addr2line', 100);
    assert.equal(backtrace.findAddr2LineBinary(temporary, 'esp32', 'xtensa'), original);
    assert.equal(backtrace.findAddr2LineBinary(temporary, 'esp32s3', 'xtensa'), s3);
    assert.equal(backtrace.findAddr2LineBinary(temporary, '', 'xtensa'), generic);
    assert.equal(backtrace.findAddr2LineBinary(temporary, 'esp32c3', 'riscv'), riscv);
});

test('ELF folder lookup preserves manual selected-output-first behavior and optional nested scanning', t => {
    const temporary = temporaryDirectory(t);
    fs.mkdirSync(path.join(temporary, 'profile'));
    fs.writeFileSync(path.join(temporary, 'old.elf'), 'old');
    fs.writeFileSync(path.join(temporary, 'profile', 'new.elf'), 'new');
    fs.utimesSync(path.join(temporary, 'old.elf'), 100, 100);
    fs.utimesSync(path.join(temporary, 'profile', 'new.elf'), 200, 200);
    assert.equal(backtrace.findNewestElfInFolder(temporary), path.join(temporary, 'old.elf'));
    assert.equal(backtrace.findNewestElfInFolder(temporary, true), path.join(temporary, 'profile', 'new.elf'));
    assert.equal(backtrace.findNewestElfInFolder(path.join(temporary, 'missing')), undefined);
});

test('finds profile-only compiler packages in the isolated Arduino cache and ignores unrelated package directories', t => {
    const temporary = temporaryDirectory(t);
    const suffix = os.platform() === 'win32' ? '.exe' : '';
    const addPackage = (name: string) => {
        const filename = path.join(temporary, 'internal', name, 'bin', 'xtensa-esp-elf-addr2line' + suffix);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, 'fixture');
        return fs.realpathSync(filename);
    };
    addPackage('esp32_esp32-arduino-libs_1.0_1234567890abcdef');
    addPackage('other_tool_1.0_1234567890abcdef');
    assert.equal(backtrace.findAddr2LineBinary(temporary, 'esp32s3', 'xtensa'), undefined);
    const tool = addPackage('esp32_esp-x32_2601_1234567890abcdef');
    assert.equal(backtrace.findAddr2LineBinary(temporary, 'esp32s3', 'xtensa'), tool);
    assert.equal(backtrace.isEsp32ProfileToolDirectory('esp32_xtensa-esp32-elf-gcc_8.4.0_1234567890abcdef'), true);
    assert.equal(backtrace.isEsp32ProfileToolDirectory('esp32_riscv32-esp-elf-gdb_17.1_1234567890abcdef'), false);
});

test('resolves common ESP32 board spellings and architectures without guessing an unknown chip', () => {
    assert.equal(backtrace.extractChipFromString('esp32:esp32:esp32c3'), 'esp32c3');
    assert.equal(backtrace.extractChipFromString('esp32dev'), 'esp32');
    assert.equal(backtrace.extractChipFromString('ESP32-S3-DevKitC-1'), 'esp32s3');
    assert.equal(backtrace.resolveEsp32Arch('esp32s3'), 'xtensa');
    assert.equal(backtrace.resolveEsp32Arch('esp32c3'), 'riscv');
    assert.equal(backtrace.resolveEsp32Arch('esp32p4'), 'riscv');
    assert.equal(backtrace.resolveEsp32Arch('esp32c99'), undefined);
    assert.equal(backtrace.extractChipFromString(12), undefined);
});

test('manual webview decoding delegates to shared service and preserves the UI result shape', async () => {
    const calls: backtrace.Addr2LineRequest[] = [];
    const messages: string[] = [];
    const frames = [{ address: '0x400d1234', functionName: 'setup()', file: 'sketch.ino', line: 7 }];
    const module = loadSource(path.resolve(__dirname, '../../../src/VueWebviewPanel.ts'), {
        vscode: {}, './utilities/getUri': {}, './utilities/getNonce': {}, './webviewConnectionHeartbeat': {},
        './shared/messages': { PROFILES_STATUS: { ACTIVE: 'active' } },
        './extension': { arduinoExtensionChannel: { appendLine: (message: string) => messages.push(message) } },
        './esp32Backtrace': { ...backtrace, findAddr2LineBinary: () => '/tools/addr2line', runAddr2Line: async (request: backtrace.Addr2LineRequest) => {
            calls.push(request); return { ...processResult(), frames };
        } },
    });
    const panel = Object.create(module.VueWebviewPanel.prototype);
    panel.findNewestElf = () => '/build/current.elf';
    panel.getArduinoDataDirectory = async () => '/arduino/data';
    panel.resolveEsp32ChipId = () => 'esp32';
    assert.deepEqual(await panel.decodeEsp32Backtrace('PC : 0x400d1234\nBacktrace: 0x400d1234:0x3ffb0000'), {
        frames, elfPath: '/build/current.elf', addr2linePath: '/tools/addr2line', arch: 'xtensa'
    });
    assert.deepEqual(calls[0], { addr2linePath: '/tools/addr2line', elfPath: '/build/current.elf', pc: '0x400d1234', addresses: ['0x400d1234'] });
    assert.ok(messages.some(message => message.includes('setup() at sketch.ino:7')));
    assert.deepEqual(await panel.decodeEsp32Backtrace(''), { frames: [], error: 'Paste a crash log to decode.' });
    assert.equal(calls.length, 1);
});
