import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiBridgeError, DeclaredDependencies, ProjectInspection } from '../contracts';
import { buildDependencyReport } from '../dependencies';

function target(declared: Partial<DeclaredDependencies> = {}, profile: string | undefined = 'release'): ProjectInspection {
    return {
        schemaVersion: 1, sketchPath: '/sketch', sketchName: 'sketch', configurationPath: '/sketch/.vscode/arduino.json',
        resolvedProfile: profile, buildPath: '/sketch/build', buildProperties: [], compileArgs: [], fingerprint: 'test', buildFingerprint: 'test',
        canCompile: true, issues: [], availableProfiles: [], declaredDependencies: { platforms: [], libraries: [], issues: [], ...declared },
    };
}

const emptyCores = { platforms: [] };
const emptyLibraries = { installed_libraries: [] };
const core = (id: string, version?: string) => ({ id, installed_version: version });
const library = (name: string, version?: string) => ({ library: { name, version } });
const invalid = (error: unknown) => error instanceof AiBridgeError && error.code === 'INVALID_CLI_OUTPUT';

test('reports installed inventories separately from declared and build-resolved dependencies', () => {
    const project = target({
        platforms: [{ id: 'arduino:avr', version: '1.8.6' }],
        libraries: [{ kind: 'index', name: 'ArduinoJson', version: '7.3.0' }],
    });
    const result = buildDependencyReport(project, {
        platforms: [{ ...core('arduino:avr', '1.8.6'), releases: { '1.8.6': { name: 'Arduino AVR Boards' } }, email: 'private@example.com' }],
    }, {
        installed_libraries: [{ library: {
            name: 'ArduinoJson', version: '7.3.0', location: 'user', container_platform: 'arduino:avr',
            install_dir: '/private/path', properties: { password: 'private-secret' }, author: 'Private Author', examples: ['/private/example'],
        }, release: { version: '8.0.0' } }],
    });
    assert.equal(result.comparison.platforms[0].status, 'installed');
    assert.equal(result.comparison.libraries[0].status, 'installed');
    assert.deepEqual(result.installed.platforms, [{ id: 'arduino:avr', version: '1.8.6', name: 'Arduino AVR Boards' }]);
    assert.deepEqual(result.installed.libraries, [{ name: 'ArduinoJson', version: '7.3.0', location: 'user', containerPlatform: 'arduino:avr' }]);
    assert.equal(result.installed.scope, 'standard_cli_installations');
    assert.equal(result.buildResolved.status, 'not_reported');
    assert.equal(result.profile, 'release');
    assert.doesNotMatch(JSON.stringify(result), /private|Private|8\.0\.0/);
    assert.equal(project.canCompile, true);
});

test('reports mismatched and missing global versions without claiming profile build failure', () => {
    const project = target({
        platforms: [{ id: 'arduino:avr', version: '1.8.6' }, { id: 'esp32:esp32', version: '3.3.0' }],
        libraries: [{ kind: 'index', name: 'ArduinoJson', version: '7.3.0' }, { kind: 'index', name: 'Missing', version: '1.0.0' }],
    });
    const result = buildDependencyReport(project, { platforms: [core('arduino:avr', '1.8.5')] }, { installed_libraries: [library('ArduinoJson', '6.0.0')] });
    assert.deepEqual(result.comparison.platforms.map(item => item.status), ['version_mismatch', 'not_found']);
    assert.deepEqual(result.comparison.libraries.map(item => item.status), ['version_mismatch', 'not_found']);
    assert.equal(result.buildResolved.status, 'not_reported');
    assert.match(result.notes[0], /do not establish whether compilation will succeed/);
    assert.equal(project.canCompile, true);
});

test('matches any installed version and keeps unpinned and local requirements distinct', () => {
    const result = buildDependencyReport(target({
        platforms: [{ id: 'manual:core' }],
        libraries: [
            { kind: 'index', name: 'ArduinoJson', version: '7.3.0' },
            { kind: 'index', name: 'Legacy' },
            { kind: 'local', directory: '../local-lib' },
        ],
    }), { platforms: [core('manual:core')] }, {
        installed_libraries: [library('ArduinoJson', '6.0.0'), library('ArduinoJson', '7.3.0'), library('ArduinoJson', '7.3.0'), library('Legacy')],
    });
    assert.equal(result.comparison.platforms[0].status, 'installed');
    assert.deepEqual(result.comparison.libraries.map(item => item.status), ['installed', 'installed', 'unknown']);
    assert.deepEqual(result.comparison.libraries[0].installedVersions, ['6.0.0', '7.3.0']);
    assert.deepEqual(result.comparison.libraries[2].installedVersions, []);
});

test('unknown installed versions cannot establish a version mismatch', () => {
    const result = buildDependencyReport(target({
        platforms: [{ id: 'manual:core', version: '1.0.0' }],
        libraries: [{ kind: 'index', name: 'Legacy', version: '1.0.0' }],
    }), { platforms: [core('manual:core', '')] }, { installed_libraries: [library('Legacy')] });
    assert.equal(result.comparison.platforms[0].status, 'unknown');
    assert.equal(result.comparison.libraries[0].status, 'unknown');
});

test('release identity accepts Arduino abbreviated versions while preserving prerelease and build metadata', () => {
    const cases: [string, string, 'installed' | 'version_mismatch'][] = [
        ['1.8', '1.8.0', 'installed'], ['2', '2.0.0', 'installed'], ['0', '0.0.0', 'installed'],
        ['1.8.0', '1.8', 'installed'], ['1.8-rc.1', '1.8.0-rc.1', 'installed'],
        ['2+build.01', '2.0.0+build.01', 'installed'], ['2-rc.1+build.01', '2.0.0-rc.1+build.01', 'installed'],
        ['1.8', '1.8.1', 'version_mismatch'], ['1.8-rc.1', '1.8.0', 'version_mismatch'],
        ['1.8-rc.1', '1.8.0-RC.1', 'version_mismatch'], ['1.8+one', '1.8.0+two', 'version_mismatch'],
        ['1.8+one', '1.8.0', 'version_mismatch'], ['01.8', '1.8.0', 'version_mismatch'],
        ['1.8-rc.01', '1.8.0-rc.1', 'version_mismatch'], ['v1.8', '1.8.0', 'version_mismatch'],
        ['>=1.8', '1.8.0', 'version_mismatch'], ['custom-version', 'custom-version', 'installed'],
    ];
    for (const [declared, installed, expected] of cases) {
        const result = buildDependencyReport(target({
            platforms: [{ id: 'vendor:core', version: declared }],
            libraries: [{ kind: 'index', name: 'Library', version: declared }],
        }), { platforms: [core('vendor:core', installed)] }, { installed_libraries: [library('Library', installed)] });
        assert.equal(result.comparison.platforms[0].status, expected, `platform ${declared} vs ${installed}`);
        assert.equal(result.comparison.libraries[0].status, expected, `library ${declared} vs ${installed}`);
        assert.deepEqual(result.comparison.libraries[0].installedVersions, [installed], 'retain the original CLI version in the report');
    }
});

test('accepts explicit empty inventory arrays and no selected profile', () => {
    const project = target();
    delete project.resolvedProfile;
    const result = buildDependencyReport(project, emptyCores, emptyLibraries);
    assert.deepEqual(result.installed.platforms, []);
    assert.deepEqual(result.installed.libraries, []);
    assert.deepEqual(result.comparison.platforms, []);
    assert.deepEqual(result.comparison.libraries, []);
    assert.equal(result.installed.complete, true);
    assert.equal(result.declaredComplete, true);
    assert.equal(result.buildResolved.status, 'not_reported');
    assert.equal(result.profile, undefined);
    assert.ok(result.notes.some(note => note.includes('No build profile')));
});

test('initialization warnings make absence uncertain without exposing raw warnings', () => {
    const result = buildDependencyReport(target({
        platforms: [{ id: 'arduino:avr', version: '1.8.6' }],
        libraries: [{ kind: 'index', name: 'ArduinoJson', version: '7.3.0' }],
    }), { platforms: [], warnings: ['Cannot read /private/packages'] }, {
        installed_libraries: [library('ArduinoJson', '6.0.0')], warnings: ['Private installation issue'],
    });
    assert.equal(result.installed.complete, false);
    assert.equal(result.installed.issues[0].code, 'CLI_INVENTORY_INCOMPLETE');
    assert.equal(result.comparison.platforms[0].status, 'unknown');
    assert.equal(result.comparison.libraries[0].status, 'unknown');
    assert.doesNotMatch(JSON.stringify(result), /private|Private/);
});

test('incomplete or malformed declarations are explicitly distinguished from complete empty requirements', () => {
    const truncated = target({ issues: [{ code: 'DEPENDENCY_LIST_TRUNCATED', message: 'Only the first declarations are included.' }] });
    assert.equal(buildDependencyReport(truncated, emptyCores, emptyLibraries).declaredComplete, false);
    const malformed = target();
    delete malformed.resolvedProfile;
    malformed.issues.push({ code: 'INVALID_YAML', message: 'Invalid YAML.' });
    const result = buildDependencyReport(malformed, emptyCores, emptyLibraries);
    assert.equal(result.declaredComplete, false);
    assert.ok(result.notes.some(note => note.includes('could not be reported completely')));
    assert.ok(!result.notes.some(note => note.includes('No build profile')));
});

test('warnings preserve positive inventory matches and do not taint the other inventory', () => {
    const result = buildDependencyReport(target({
        platforms: [{ id: 'arduino:avr', version: '1.8.6' }],
        libraries: [{ kind: 'index', name: 'ArduinoJson', version: '7.3.0' }],
    }), emptyCores, { installed_libraries: [library('ArduinoJson', '7.3.0')], warnings: ['Some package failed to initialize.'] });
    assert.equal(result.comparison.platforms[0].status, 'not_found');
    assert.equal(result.comparison.libraries[0].status, 'installed');
    assert.equal(result.installed.complete, false);
});

test('rejects malformed inventory wrappers, entries, and field types', () => {
    for (const value of [undefined, null, [], {}, { platforms: null }, { platforms: {} }, { platforms: [null] }, { platforms: [{}] },
        { platforms: [{ id: 'x:y', installed_version: 123 }] }, { platforms: [{ id: 'x:y', releases: [] }] },
        { platforms: [{ id: 'x:y', installed_version: '1', releases: { '1': { name: 7 } } }] }, { platforms: [], warnings: {} }]) {
        assert.throws(() => buildDependencyReport(target(), value, emptyLibraries), invalid);
    }
    for (const value of [undefined, null, [], {}, { installed_libraries: null }, { installed_libraries: [null] },
        { installed_libraries: [{ name: 'Wrong shape' }] }, { installed_libraries: [{ library: {} }] },
        { installed_libraries: [{ library: { name: 'x', version: 1 } }] },
        { installed_libraries: [{ library: { name: 'x', location: {} } }] }, { installed_libraries: [], warnings: [5] }]) {
        assert.throws(() => buildDependencyReport(target(), emptyCores, value), invalid);
    }
});

test('rejects oversized inventory and output instead of comparing partial lists', () => {
    assert.throws(() => buildDependencyReport(target(), { platforms: Array.from({ length: 1001 }, () => core('x:y', '1')) }, emptyLibraries), invalid);
    assert.throws(() => buildDependencyReport(target(), emptyCores, { installed_libraries: [library('x'.repeat(513), '1')] }), invalid);
    assert.throws(() => buildDependencyReport(target(), emptyCores, {
        installed_libraries: Array.from({ length: 1000 }, () => library('x'.repeat(512), '1')),
    }), invalid);
    assert.throws(() => buildDependencyReport(target(), { platforms: [core('x:\ny', '1')] }, emptyLibraries), invalid);
});
