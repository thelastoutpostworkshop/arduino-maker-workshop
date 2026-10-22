import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompileDependenciesCollector, unavailableCompileDependencies } from '../compileDependencies';

const successful = { status: 'success' as const, truncated: false, incomplete: false };

function table(kind: 'Used library' | 'Used platform', rows: string[][]): string[] {
    const names = Math.max(kind.length, ...rows.map(row => Array.from(row[0]).length)) + 1;
    const versions = Math.max('Version'.length, ...rows.map(row => Array.from(row[1]).length)) + 1;
    return [[kind, 'Version', 'Path'], ...rows]
        .map(row => row[0] + ' '.repeat(names - Array.from(row[0]).length)
            + row[1] + ' '.repeat(versions - Array.from(row[1]).length) + row[2]);
}

function lines(collector: CompileDependenciesCollector, values: string[], stream: 'stdout' | 'stderr' = 'stdout'): void {
    for (const line of values) { collector.line(line, stream); }
}

test('resolved usage tables preserve library names, versions, platform IDs, and paths with spaces', () => {
    const collector = new CompileDependenciesCollector();
    lines(collector, table('Used library', [
        ['Adafruit NeoPixel', '1.15.1', 'C:\\Users\\Maker Name\\Arduino\\libraries\\Adafruit_NeoPixel'],
        ['Ethernet', '2.0.2', '/home/maker/.arduino15/packages/custom/libraries/Ethernet'],
    ]));
    collector.line('', 'stdout');
    lines(collector, table('Used platform', [
        ['esp32:esp32', '3.3.2', 'C:\\Arduino Data\\packages\\esp32\\hardware\\esp32\\3.3.2'],
        ['arduino:avr', '1.8.6', '/home/maker/.arduino15/packages/arduino/hardware/avr/1.8.6'],
    ]));
    const report = collector.finish(successful);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.libraries, [
        { name: 'Adafruit NeoPixel', version: '1.15.1', path: 'C:\\Users\\Maker Name\\Arduino\\libraries\\Adafruit_NeoPixel' },
        { name: 'Ethernet', version: '2.0.2', path: '/home/maker/.arduino15/packages/custom/libraries/Ethernet' },
    ]);
    assert.deepEqual(report.platforms, [
        { id: 'esp32:esp32', version: '3.3.2', path: 'C:\\Arduino Data\\packages\\esp32\\hardware\\esp32\\3.3.2' },
        { id: 'arduino:avr', version: '1.8.6', path: '/home/maker/.arduino15/packages/arduino/hardware/avr/1.8.6' },
    ]);
});

test('English verbose library messages and final tables deduplicate actual resolved dependencies', () => {
    const collector = new CompileDependenciesCollector();
    collector.line('Using library Adafruit NeoPixel at version 1.15.1 in folder: /libraries/Adafruit NeoPixel ', 'stdout');
    collector.line('Using library Local Library in folder: /sketch/libraries/Local Library (legacy)', 'stdout');
    lines(collector, table('Used library', [
        ['Adafruit NeoPixel', '1.15.1', '/libraries/Adafruit NeoPixel'],
        ['Local Library', '', '/sketch/libraries/Local Library'],
    ]));
    collector.line('', 'stdout');
    lines(collector, table('Used platform', [['arduino:avr', '1.8.6', '/packages/arduino/hardware/avr/1.8.6']]));
    const report = collector.finish(successful);
    assert.equal(report.status, 'partial');
    assert.equal(report.libraries.length, 2);
    assert.deepEqual(report.libraries[1], { name: 'Local Library', path: '/sketch/libraries/Local Library' });
    assert.match(report.notes.join(' '), /no reported version/);
});

test('table columns follow Arduino CLI Unicode rune padding for accented and astral library names', () => {
    const collector = new CompileDependenciesCollector();
    lines(collector, table('Used library', [
        ['Temp\u00e9rature \u{1f321}\ufe0f Sensor', '1.2.3', '/libraries/Temp\u00e9rature \u{1f321}\ufe0f Sensor'],
        ['Wire', '3.3.2', '/libraries/Wire'],
    ]));
    lines(collector, table('Used platform', [['esp32:esp32', '3.3.2', '/platforms/esp32']]));
    const report = collector.finish(successful);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.libraries, [
        { name: 'Temp\u00e9rature \u{1f321}\ufe0f Sensor', version: '1.2.3', path: '/libraries/Temp\u00e9rature \u{1f321}\ufe0f Sensor' },
        { name: 'Wire', version: '3.3.2', path: '/libraries/Wire' },
    ]);
});

test('French verbose messages match bundled CLI translations without changing the output language', () => {
    const collector = new CompileDependenciesCollector();
    collector.line('Utilisation de la biblioth\u00e8que Capteur de temp\u00e9rature version 1.2.3 dans le dossier: C:\\Arduino\\libraries\\Capteur de temp\u00e9rature ', 'stdout');
    collector.line('Utilisation de la biblioth\u00e8que Ancienne prise dans le dossier: /sketch/libraries/Ancienne (h\u00e9ritage)', 'stderr');
    lines(collector, table('Used platform', [['esp32:esp32', '3.3.2', '/profile cache/platforms/esp32/3.3.2']]));
    const report = collector.finish(successful);
    assert.deepEqual(report.libraries, [
        { name: 'Capteur de temp\u00e9rature', version: '1.2.3', path: 'C:\\Arduino\\libraries\\Capteur de temp\u00e9rature' },
        { name: 'Ancienne', path: '/sketch/libraries/Ancienne' },
    ]);
    assert.equal(report.platforms[0].version, '3.3.2');
});

test('literal legacy suffixes in modern library paths are preserved before parsing actual legacy markers', () => {
    const collector = new CompileDependenciesCollector();
    lines(collector, [
        'Using library Versioned at version 1.0.0 in folder: /libraries/Versioned (legacy) ',
        'Using library Modern in folder: /libraries/Modern (legacy) ',
        'Using library Legacy in folder: /libraries/Legacy (legacy) (legacy)',
        'Utilisation de la biblioth\u00e8que Version fran\u00e7aise version 1.0.0 dans le dossier: /libraries/Version fran\u00e7aise (h\u00e9ritage) ',
        'Utilisation de la biblioth\u00e8que Moderne prise dans le dossier: /libraries/Moderne (h\u00e9ritage) ',
        'Utilisation de la biblioth\u00e8que Ancienne prise dans le dossier: /libraries/Ancienne (h\u00e9ritage) (h\u00e9ritage)',
    ]);
    lines(collector, table('Used library', [
        ['Versioned', '1.0.0', '/libraries/Versioned (legacy)'],
        ['Modern', '', '/libraries/Modern (legacy)'],
        ['Legacy', '', '/libraries/Legacy (legacy)'],
        ['Version fran\u00e7aise', '1.0.0', '/libraries/Version fran\u00e7aise (h\u00e9ritage)'],
        ['Moderne', '', '/libraries/Moderne (h\u00e9ritage)'],
        ['Ancienne', '', '/libraries/Ancienne (h\u00e9ritage)'],
    ]));
    const report = collector.finish(successful);
    assert.equal(report.libraries.length, 6);
    assert.deepEqual(report.libraries.map(item => item.path), [
        '/libraries/Versioned (legacy)', '/libraries/Modern (legacy)', '/libraries/Legacy (legacy)',
        '/libraries/Version fran\u00e7aise (h\u00e9ritage)', '/libraries/Moderne (h\u00e9ritage)', '/libraries/Ancienne (h\u00e9ritage)',
    ]);
    assert.doesNotMatch(report.notes.join(' '), /different versions or paths/);
});

test('table state is independent across stdout and stderr and preserves UNC paths', () => {
    const collector = new CompileDependenciesCollector();
    const libraries = table('Used library', [['Wire', '3.3.2', '\\\\server\\Arduino Data\\libraries\\Wire']]);
    const platforms = table('Used platform', [['esp32:esp32', '3.3.2', '/platforms/esp32']]);
    collector.line(libraries[0], 'stdout');
    collector.line(platforms[0], 'stderr');
    collector.line('main.ino:2: warning: example warning', 'stderr');
    collector.line(libraries[1] + '\r', 'stdout');
    lines(collector, platforms, 'stderr');
    const report = collector.finish(successful);
    assert.deepEqual(report.libraries, [{ name: 'Wire', version: '3.3.2', path: '\\\\server\\Arduino Data\\libraries\\Wire' }]);
    assert.equal(report.platforms[0].id, 'esp32:esp32');
    assert.equal(report.status, 'partial');
    assert.match(report.notes.join(' '), /table rows/);
});

test('unknown library versions can be completed by later output without duplicate or guessed entries', () => {
    const collector = new CompileDependenciesCollector();
    collector.line('Using library Wire in folder: /libraries/Wire ', 'stdout');
    lines(collector, table('Used library', [['Wire', '1.0.0', '/libraries/Wire']]));
    collector.line('Using library Wire in folder: /libraries/Wire ', 'stdout');
    lines(collector, table('Used platform', [['arduino:avr', '1.8.6', '/platforms/avr']]));
    const report = collector.finish(successful);
    assert.equal(report.status, 'available');
    assert.deepEqual(report.libraries, [{ name: 'Wire', version: '1.0.0', path: '/libraries/Wire' }]);
});

test('different versions or paths are preserved as conflicts instead of overwritten', () => {
    const collector = new CompileDependenciesCollector();
    lines(collector, table('Used library', [
        ['Wire', '1.0.0', '/libraries/Wire'], ['Wire', '2.0.0', '/libraries/Wire'], ['Wire', '2.0.0', '/custom/Wire'],
    ]));
    lines(collector, table('Used platform', [
        ['arduino:avr', '1.8.5', '/platforms/avr'], ['arduino:avr', '1.8.6', '/platforms/avr'],
    ]));
    const report = collector.finish(successful);
    assert.equal(report.status, 'partial');
    assert.equal(report.libraries.length, 3);
    assert.equal(report.platforms.length, 2);
    assert.match(report.notes.join(' '), /distinct entries are preserved/);
});

test('inventory tables, declared dependencies, library candidates, and board/core paths are not used dependency evidence', () => {
    const collector = new CompileDependenciesCollector();
    lines(collector, [
        'Name Installed Available Location',
        'Wire 1.0.0 1.1.0 user',
        'Multiple libraries were found for "Wire.h"',
        '  Used: /libraries/Wire',
        '  Not used: /libraries/OtherWire',
        "Using board 'uno' from platform in folder: /packages/arduino/hardware/avr/1.8.6",
        "Using core 'arduino' from platform in folder: /packages/arduino/hardware/avr/1.8.6",
        'FQBN: arduino:avr:uno',
        'Library version: 1.0.0',
        'Bibliothek Wire in Version 1.0.0 im Ordner /libraries/Wire wird verwendet',
    ]);
    const report = collector.finish(successful);
    assert.equal(report.status, 'unavailable');
    assert.deepEqual(report.libraries, []);
    assert.deepEqual(report.platforms, []);
    assert.match(report.notes.join(' '), /not inferred from folder names/);
});

test('an absent library table does not claim a build has no libraries', () => {
    const collector = new CompileDependenciesCollector();
    lines(collector, table('Used platform', [['arduino:avr', '1.8.6', '/platforms/avr']]));
    const report = collector.finish(successful);
    assert.equal(report.status, 'partial');
    assert.deepEqual(report.libraries, []);
    assert.match(report.notes.join(' '), /does not establish that the sketch uses no libraries/);
    assert.match(new CompileDependenciesCollector().finish(successful).notes.join(' '), /Verbose Compile disabled/);
});

test('failed, canceled, omitted, and truncated output retains known entries but marks them partial', () => {
    for (const input of [
        { ...successful, status: 'failed' as const },
        { ...successful, status: 'canceled' as const },
        { ...successful, truncated: true },
        { ...successful, incomplete: true },
    ]) {
        const collector = new CompileDependenciesCollector();
        lines(collector, table('Used library', [['Wire', '1.0.0', '/libraries/Wire']]));
        lines(collector, table('Used platform', [['arduino:avr', '1.8.6', '/platforms/avr']]));
        for (let i = 0; i < 20000; i++) { collector.line('verbose compiler command', 'stderr'); }
        const report = collector.finish(input);
        assert.equal(report.status, 'partial');
        assert.equal(report.libraries[0].version, '1.0.0');
        assert.equal(report.platforms[0].version, '1.8.6');
    }
});

test('malformed tables stop at an unknown row and resume only at another supported header', () => {
    const collector = new CompileDependenciesCollector();
    const libraryTable = table('Used library', [['Wire', '1.0.0', '/libraries/Wire']]);
    collector.line(libraryTable[0], 'stdout');
    collector.line('This is not a dependency row', 'stdout');
    collector.line(libraryTable[1], 'stdout');
    assert.deepEqual(collector.finish(successful).libraries, []);
    const recovered = new CompileDependenciesCollector();
    lines(recovered, table('Used platform', [['not:a:platform', '1.0', '/invalid']]));
    lines(recovered, libraryTable);
    assert.equal(recovered.finish(successful).libraries[0].name, 'Wire');
});

test('relative installation paths, control characters, and multiline input do not create dependency entries', () => {
    const collector = new CompileDependenciesCollector();
    collector.line('Using library Example at version 1.0.0 in folder: relative/library ', 'stdout');
    collector.line('Using library Example at version 1.0.0 in folder: /libraries/Bad\u0000Name ', 'stdout');
    collector.line('Using library Example at version 1.0.0 in folder: /libraries/Example\nUsed platform Version Path', 'stdout');
    assert.equal(collector.finish(successful).status, 'unavailable');
});

test('library/platform counts and field bounds keep the report bounded without truncating identities', () => {
    const collector = new CompileDependenciesCollector();
    for (let i = 0; i < 150; i++) {
        collector.line(`Using library Library ${i} at version 1.0.0 in folder: /libraries/Library ${i} `, 'stdout');
    }
    lines(collector, table('Used platform', Array.from({ length: 25 }, (_, i) => [`vendor:arch${i}`, '1.0.0', `/platforms/arch${i}`])));
    const report = collector.finish(successful);
    assert.equal(report.status, 'partial');
    assert.equal(report.libraries.length, 100);
    assert.equal(report.platforms.length, 20);
    assert.match(report.notes.join(' '), /exceeded limits/);

    const oversized = new CompileDependenciesCollector();
    oversized.line(`Using library ${'\u00e9'.repeat(300)} at version 1.0 in folder: /library `, 'stdout');
    oversized.line(`Using library Huge version at version ${'1'.repeat(129)} in folder: /library `, 'stdout');
    oversized.line(`Using library Huge path at version 1.0 in folder: /${'p'.repeat(4096)} `, 'stdout');
    oversized.line('x'.repeat(16385), 'stdout');
    oversized.line('Using library Real at version 1.0 in folder: /libraries/Real ', 'stdout');
    assert.deepEqual(oversized.finish(successful).libraries, [{ name: 'Real', version: '1.0', path: '/libraries/Real' }]);
});

test('total retained dependency text has a byte limit independently of item count', () => {
    const collector = new CompileDependenciesCollector();
    for (let i = 0; i < 80; i++) {
        collector.line(`Using library Library${i} at version 1.0 in folder: /${'p'.repeat(3999)} `, 'stdout');
    }
    const report = collector.finish(successful);
    assert.equal(report.status, 'partial');
    assert.ok(report.libraries.length < 80);
    assert.ok(report.libraries.reduce((bytes, item) => bytes + Buffer.byteLength(item.name + item.version + item.path), 0) <= 192 * 1024);
    assert.match(report.notes.join(' '), /192 KiB/);
});

test('finalization is stable and unavailable explanations are bounded UTF-8 text', () => {
    const collector = new CompileDependenciesCollector();
    collector.line('Using library Wire at version 1.0.0 in folder: /libraries/Wire ', 'stdout');
    const report = collector.finish(successful);
    collector.line('Using library SPI at version 1.0.0 in folder: /libraries/SPI ', 'stdout');
    assert.strictEqual(collector.finish(successful), report);
    assert.equal(report.libraries.length, 1);
    assert.deepEqual(unavailableCompileDependencies('Compilation did not start.'), {
        status: 'unavailable', libraries: [], platforms: [], notes: ['Compilation did not start.'],
    });
    const unavailable = unavailableCompileDependencies('\u00e9'.repeat(2000));
    assert.ok(Buffer.byteLength(unavailable.notes[0]) <= 2048);
    assert.doesNotMatch(unavailable.notes[0], /\ufffd/);
});
