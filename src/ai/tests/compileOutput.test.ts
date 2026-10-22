import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompileOutputCollector, unavailableCompileOutput } from '../compileOutput';

const englishFlash = 'Sketch uses 291184 bytes (9%) of program storage space. Maximum is 3145728 bytes.';
const englishRam = 'Global variables use 22984 bytes (7%) of dynamic memory, leaving 304696 bytes for local variables. Maximum is 327680 bytes.';

test('compiler diagnostics preserve locations, warning codes, and note severity across streams and arbitrary chunks', () => {
    const collector = new CompileOutputCollector('/home/maker/sketch');
    collector.stdout('\u001b[01;33m/home/maker/sketch/main.ino:12:7: warn');
    collector.stderr('src/helper.cpp:5: error: expected declaration\r\n');
    collector.stdout('ing: unused variable \u001b[0m[-Wunused-variable]\r\n');
    collector.stderr('src/helper.cpp:2:1: note: declared here');
    const result = collector.finish({ status: 'failed', truncated: false });
    assert.equal(result.diagnostics.status, 'available');
    assert.deepEqual(result.diagnostics.items, [
        { severity: 'error', file: '/home/maker/sketch/src/helper.cpp', line: 5, message: 'expected declaration' },
        { severity: 'warning', file: '/home/maker/sketch/main.ino', line: 12, column: 7, message: 'unused variable', code: '-Wunused-variable' },
        { severity: 'note', file: '/home/maker/sketch/src/helper.cpp', line: 2, column: 1, message: 'declared here' },
    ]);
    assert.equal(result.memory.status, 'unavailable');
});

test('Windows drive paths, spaces, relative files, and command-line pseudo files are parsed without filesystem access', () => {
    const collector = new CompileOutputCollector('C:\\My Sketch');
    collector.stderr('C:\\My Sketch\\main.ino:3:14: fatal error: absent.h: No such file or directory\n');
    collector.stderr('src\\helper.cpp:22: warning: extension warning\n<command-line>:1: note: macro definition\n');
    const result = collector.finish({ status: 'failed', truncated: false });
    assert.deepEqual(result.diagnostics.items, [
        { severity: 'error', file: 'C:\\My Sketch\\main.ino', line: 3, column: 14, message: 'absent.h: No such file or directory' },
        { severity: 'warning', file: 'C:\\My Sketch\\src\\helper.cpp', line: 22, message: 'extension warning' },
        { severity: 'note', file: '<command-line>', line: 1, message: 'macro definition' },
    ]);
});

test('driver, linker, and Arduino CLI failures need no source location', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr([
        'cc1plus: fatal error: cannot execute compiler',
        'C:\\Tool Chain\\bin\\xtensa-esp32-elf-g++.exe: error: unrecognized command-line option',
        '/tools/bin/avr-ld: cannot find -lmissing',
        'C:\\tools\\riscv32-esp-elf-ld.exe: region `iram0_0_seg\' overflowed by 64 bytes',
        '/build/main.o:(.text+0x42): undefined reference to `setup\'',
        'collect2: error: ld returned 1 exit status',
        'Error during build: exit status 1',
        'Compilation error: exit status 1',
    ].join('\n'));
    const items = collector.finish({ status: 'failed', truncated: false }).diagnostics.items;
    assert.equal(items.length, 8);
    assert.ok(items.every(item => item.severity === 'error' && !item.file && item.line === undefined));
    assert.match(items[3].message, /overflowed by 64 bytes/);
    assert.equal(items[4].message, "undefined reference to `setup'");
});

test('linker references preserve a source location when the toolchain supplies one without a severity prefix', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr("src/helper.cpp:5: undefined reference to `setup'\n");
    collector.stderr("C:\\Sketch\\helper.cpp:9:3: multiple definition of `loop'\n");
    assert.deepEqual(collector.finish({ status: 'failed', truncated: false }).diagnostics.items, [
        { severity: 'error', file: '/sketch/src/helper.cpp', line: 5, message: "undefined reference to `setup'" },
        { severity: 'error', file: 'C:\\Sketch\\helper.cpp', line: 9, column: 3, message: "multiple definition of `loop'" },
    ]);
});

test('source snippets, caret lines, command arguments, and unsupported locale are not invented diagnostics', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout('g++ -Dsome_error=1 -c main.cpp\nUsing library Example at version 1.0\n');
    collector.stderr('   10 | error: unknown_identifier\n      | ^~~~~\nmain.ino:10:3: erreur: identifiant inconnu\n');
    const result = collector.finish({ status: 'failed', truncated: false });
    assert.equal(result.diagnostics.status, 'unavailable');
    assert.deepEqual(result.diagnostics.items, []);
    assert.match(result.diagnostics.notes.join(' '), /does not establish/);
});

test('empty diagnostics are explicitly unavailable even after a successful compile', () => {
    const result = new CompileOutputCollector('/sketch').finish({ status: 'success', truncated: false });
    assert.equal(result.diagnostics.status, 'unavailable');
    assert.equal(result.memory.status, 'unavailable');
    assert.match(result.memory.notes.join(' '), /No supported memory summary/);
});

test('used dependency tables survive ANSI decoration, split chunks and interleaved diagnostic streams', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout('\u001b[32mUsed lib');
    collector.stderr('main.ino:1: warning: warning during dependency reporting\n');
    collector.stdout('rary'.padEnd(20 - 'Used lib'.length) + 'Version'.padEnd(10) + 'Path\u001b[0m\n');
    collector.stdout('Sensor Library'.padEnd(20) + '2.1.0'.padEnd(10) + '/profile cache/libraries/SensorLibrary\n\n');
    collector.stdout('Used platform'.padEnd(20) + 'Version'.padEnd(10) + 'Path\n');
    collector.stdout('vendor:arch'.padEnd(20) + '3.0.0'.padEnd(10) + '/profile cache/hardware/arch/3.0.0');
    const result = collector.finish({ status: 'success', truncated: false });
    assert.equal(result.dependencies.status, 'available');
    assert.deepEqual(result.dependencies.libraries, [
        { name: 'Sensor Library', version: '2.1.0', path: '/profile cache/libraries/SensorLibrary' },
    ]);
    assert.deepEqual(result.dependencies.platforms, [
        { id: 'vendor:arch', version: '3.0.0', path: '/profile cache/hardware/arch/3.0.0' },
    ]);
    assert.equal(result.diagnostics.items.length, 1);
});

test('English standard flash and RAM summaries expose reported integers, including zero usage', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout(englishFlash + '\r\n');
    collector.stdout(englishRam.slice(0, 55));
    collector.stdout(englishRam.slice(55));
    const result = collector.finish({ status: 'success', truncated: false });
    assert.deepEqual(result.memory, {
        status: 'available', flash: { usedBytes: 291184, percent: 9, maxBytes: 3145728 },
        ram: { usedBytes: 22984, percent: 7, maxBytes: 327680 }, notes: [],
    });
    const zero = new CompileOutputCollector('/sketch');
    zero.stdout('Sketch uses 0 bytes (0%) of program storage space. Maximum is 100 bytes.\nGlobal variables use 0 bytes of dynamic memory.');
    assert.deepEqual(zero.finish({ status: 'success', truncated: false }).memory, {
        status: 'available', flash: { usedBytes: 0, percent: 0, maxBytes: 100 }, ram: { usedBytes: 0 }, notes: [],
    });
});

test('French standard memory summaries remain available without changing CLI language', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout("Le croquis utilise 291184 octets (9%) de l'espace de stockage de programmes. Le maximum est de 3145728 octets.\n");
    collector.stdout('Les variables globales utilisent 22984 octets (7%) de m\u00e9moire dynamique, ce qui laisse 304696 octets pour les variables locales. Le maximum est de 327680 octets.\n');
    const result = collector.finish({ status: 'success', truncated: false });
    assert.equal(result.memory.status, 'available');
    assert.deepEqual(result.memory.flash, { usedBytes: 291184, percent: 9, maxBytes: 3145728 });
    assert.deepEqual(result.memory.ram, { usedBytes: 22984, percent: 7, maxBytes: 327680 });
    const onlyRam = new CompileOutputCollector('/sketch');
    onlyRam.stdout('Les variables globales utilisent 22984 octets de m\u00e9moire dynamique.\n');
    assert.deepEqual(onlyRam.finish({ status: 'success', truncated: false }).memory.ram, { usedBytes: 22984 });
});

test('missing memory regions and unsupported advanced sizer output are explicit, with no inferred capacity', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout(englishFlash + '\n');
    const memory = collector.finish({ status: 'success', truncated: false }).memory;
    assert.equal(memory.status, 'partial');
    assert.equal(memory.ram, undefined);
    assert.match(memory.notes.join(' '), /RAM/);
    const custom = new CompileOutputCollector('/sketch');
    custom.stdout('RAM: 10 KB used, capacity: 200 KB\ntext data bss dec hex filename\n123 456 789 1368 558 sketch.elf\n');
    assert.equal(custom.finish({ status: 'success', truncated: false }).memory.status, 'unavailable');
});

test('over-capacity memory remains meaningful after failure and does not become artifact validity', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout('Sketch uses 120 bytes (120%) of program storage space. Maximum is 100 bytes.\n');
    collector.stdout('Global variables use 105 bytes (105%) of dynamic memory, leaving -5 bytes for local variables. Maximum is 100 bytes.\n');
    const memory = collector.finish({ status: 'failed', truncated: false }).memory;
    assert.equal(memory.status, 'available');
    assert.deepEqual(memory.flash, { usedBytes: 120, percent: 120, maxBytes: 100 });
    assert.deepEqual(memory.ram, { usedBytes: 105, percent: 105, maxBytes: 100 });
});

test('invalid numeric values are rejected instead of rounded or guessed', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stdout('Sketch uses 9007199254740993 bytes (9%) of program storage space. Maximum is 100 bytes.\n');
    collector.stdout('Global variables use 1 bytes (1%) of dynamic memory, leaving 0 bytes for local variables. Maximum is 0 bytes.\n');
    collector.stderr('main.ino:9007199254740993:3: error: invalid location\n');
    const result = collector.finish({ status: 'failed', truncated: false });
    assert.equal(result.memory.status, 'unavailable');
    assert.equal(result.diagnostics.status, 'unavailable');
});

test('streaming extraction retains early diagnostics and memory even when raw output is truncated', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr('main.ino:2: warning: early warning\n');
    collector.stdout(englishFlash + '\n' + englishRam + '\n');
    for (let i = 0; i < 20000; i++) { collector.stdout('A later verbose command line without diagnostics\n'); }
    const result = collector.finish({ status: 'success', truncated: true });
    assert.equal(result.diagnostics.items[0].message, 'early warning');
    assert.equal(result.diagnostics.status, 'partial');
    assert.equal(result.memory.status, 'partial');
    assert.equal(result.memory.flash?.usedBytes, 291184);
    assert.match(result.diagnostics.notes.join(' '), /collected separately/);
});

test('diagnostic counts and UTF-8 message bounds are enforced without corrupting following lines', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr('main.ino:1: error: ' + '\u00e9'.repeat(2000) + '\n');
    for (let i = 0; i < 150; i++) { collector.stderr(`main.ino:${i + 2}: warning: warning ${i}\n`); }
    const result = collector.finish({ status: 'failed', truncated: false }).diagnostics;
    assert.equal(result.status, 'partial');
    assert.equal(result.items.length, 100);
    assert.ok(Buffer.byteLength(result.items[0].message) <= 2048);
    assert.doesNotMatch(result.items[0].message, /\ufffd/);
    assert.ok(result.items[0].message.endsWith('...'));
    assert.equal(result.items[99].line, 100);
});

test('oversized partial lines are discarded until newline and cannot create a false tail diagnostic', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr('x'.repeat(16000));
    collector.stderr('y'.repeat(1000));
    collector.stderr('main.ino:1: error: false error\nmain.ino:2: error: real error\n');
    const result = collector.finish({ status: 'failed', truncated: false });
    assert.equal(result.diagnostics.status, 'partial');
    assert.equal(result.diagnostics.items.length, 1);
    assert.equal(result.diagnostics.items[0].message, 'real error');
    assert.match(result.diagnostics.notes.join(' '), /Oversized/);
});

test('cancellation and conflicting memory summaries explicitly mark collected data partial', () => {
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr('main.ino:1: warning: known warning\n');
    collector.stdout(englishFlash + '\n' + englishRam + '\n');
    const canceled = collector.finish({ status: 'canceled', truncated: false });
    assert.equal(canceled.diagnostics.status, 'partial');
    assert.equal(canceled.memory.status, 'partial');
    const conflicts = new CompileOutputCollector('/sketch');
    conflicts.stdout(englishFlash + '\n' + englishRam + '\n' + englishFlash.replace('291184', '291185') + '\n');
    const memory = conflicts.finish({ status: 'success', truncated: false }).memory;
    assert.equal(memory.status, 'partial');
    assert.equal(memory.flash?.usedBytes, 291185);
    assert.match(memory.notes.join(' '), /Multiple different/);
});

test('unavailable reports explain why and finalization does not duplicate pending diagnostics', () => {
    assert.deepEqual(unavailableCompileOutput('The CLI could not start.'), {
        diagnostics: { status: 'unavailable', items: [], notes: ['The CLI could not start.'] },
        memory: { status: 'unavailable', notes: ['The CLI could not start.'] },
        dependencies: { status: 'unavailable', libraries: [], platforms: [], notes: ['The CLI could not start.'] },
    });
    const collector = new CompileOutputCollector('/sketch');
    collector.stderr('main.ino:1: error: interrupted line');
    const first = collector.finish({ status: 'failed', truncated: false });
    assert.strictEqual(collector.finish({ status: 'failed', truncated: false }), first);
    assert.equal(first.diagnostics.items.length, 1);
});
