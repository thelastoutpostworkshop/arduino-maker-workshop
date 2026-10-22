import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiBridgeError, ProjectInspection } from '../contracts';
import { buildBoardDetails, buildExamples, buildLibrarySearch } from '../discovery';

function target(fqbn: string | undefined = 'vendor:arch:board:Speed=fast'): ProjectInspection {
    return {
        schemaVersion: 1, sketchPath: '/sketch', sketchName: 'sketch', configurationPath: '/sketch/.vscode/arduino.json',
        resolvedProfile: 'release', fqbn, buildPath: '/sketch/build', buildProperties: ['token=secret'], compileArgs: [], fingerprint: 'test', buildFingerprint: 'test',
        canCompile: true, issues: [], availableProfiles: [], declaredDependencies: { platforms: [], libraries: [], issues: [] },
    };
}
const board = () => ({
    name: 'Example board', fqbn: 'vendor:arch:board', version: '1.2.3',
    config_options: [{ option: 'Speed', option_label: 'Clock speed', values: [
        { value: 'slow', value_label: 'Slow', selected: true }, { value: 'fast', value_label: 'Fast', selected: false },
    ] }],
});
const library = (name: string, versions = ['1.0.0', '2.0.0']) => ({
    name, latest: { version: '2.0.0', sentence: 'A useful library.', architectures: ['*'] }, available_versions: versions,
});
const installed = (name: string, location: string, examples: string[] = [], platform?: string) => ({ library: {
    name, location, examples, ...(platform ? { container_platform: platform } : {}),
} });
const invalid = (error: unknown) => error instanceof AiBridgeError && error.code === 'INVALID_CLI_OUTPUT';

test('board details preserve profile target, distinguish defaults from selected options, and whitelist fields', () => {
    const result = buildBoardDetails(target(), {
        ...board(), build_properties: ['password=private'], programmers: [{ name: 'private' }],
        config_options: board().config_options.map(option => ({ ...option, secret: 'private' })),
    });
    assert.equal(result.scope, 'standard_cli_installations');
    assert.equal(result.profile, 'release');
    assert.equal(result.fqbn, 'vendor:arch:board:Speed=fast');
    assert.equal(result.board.fqbn, 'vendor:arch:board');
    assert.equal(result.board.options[0].defaultValue, 'slow');
    assert.equal(result.board.options[0].selectedValue, 'fast');
    assert.deepEqual(result.board.options[0].values, [{ value: 'fast', label: 'Fast' }, { value: 'slow', label: 'Slow' }]);
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.doesNotMatch(JSON.stringify(result), /private|token|password|programmers|buildProperties/);
});

test('board defaults apply without overrides and boards without options remain valid', () => {
    assert.equal(buildBoardDetails(target('vendor:arch:board'), board()).board.options[0].selectedValue, 'slow');
    const result = buildBoardDetails(target('vendor:arch:board'), { ...board(), config_options: [] });
    assert.deepEqual(result.board.options, []);
    assert.equal(result.complete, true);
    const withoutMenus = buildBoardDetails(target('vendor:arch:board'), { name: 'Fixed board', fqbn: 'vendor:arch:board' });
    assert.deepEqual(withoutMenus.board.options, []);
    assert.equal(withoutMenus.complete, true);
});

test('unknown values, unknown options, and absent defaults explicitly leave board details incomplete', () => {
    for (const fqbn of ['vendor:arch:board:Speed=missing', 'vendor:arch:board:Missing=value', 'vendor:arch:board:Speed=fast,Speed=slow']) {
        const result = buildBoardDetails(target(fqbn), board());
        assert.equal(result.complete, false);
        assert.ok(result.issues.some(issue => issue.code === 'BOARD_OPTIONS_UNRESOLVED'));
    }
    assert.equal(buildBoardDetails(target('vendor:arch:board:Speed=missing'), board()).board.options[0].selectedValue, undefined);
    const raw = board();
    raw.config_options[0].values[0].selected = false;
    const result = buildBoardDetails(target('vendor:arch:board'), raw);
    assert.equal(result.board.options[0].defaultValue, undefined);
    assert.equal(result.board.options[0].selectedValue, undefined);
    assert.equal(result.complete, false);
});

test('board option truncation keeps default and selected values visible', () => {
    const result = buildBoardDetails(target('vendor:arch:board:Speed=v299'), {
        ...board(), config_options: [{ option: 'Speed', option_label: 'Clock speed', values: Array.from({ length: 300 }, (_, index) => ({
            value: `v${index.toString().padStart(3, '0')}`, value_label: `Value ${index}`, selected: index === 298,
        })) }],
    });
    assert.equal(result.truncated, true);
    assert.equal(result.complete, false);
    assert.equal(result.board.options[0].values.length, 200);
    assert.equal(result.board.options[0].valuesTruncated, true);
    assert.ok(result.board.options[0].values.some(value => value.value === 'v298'));
    assert.ok(result.board.options[0].values.some(value => value.value === 'v299'));
});

test('board details reject malformed metadata, duplicate options, and mismatched FQBNs', () => {
    for (const raw of [null, {}, { ...board(), config_options: {} }, { ...board(), fqbn: 'other:arch:board' },
        { ...board(), config_options: [board().config_options[0], board().config_options[0]] },
        { ...board(), config_options: [{ option: 'Speed', option_label: 'Speed', values: [] }] },
        { ...board(), config_options: [{ option: 'Speed', option_label: 'Speed', values: [{ value: 'fast', value_label: 'Fast', selected: 'yes' }] }] }]) {
        assert.throws(() => buildBoardDetails(target(), raw), invalid);
    }
});

test('library search returns sorted deduplicated versions and bounded public metadata', () => {
    const result = buildLibrarySearch(target(), 'sensor', 20, { status: 'success', libraries: [library('Zulu'), {
        ...library('Alpha', ['2.0.0', '1.0.0', '2.0.0']), author: 'private-author', releases: { secret: 'private-url' },
        latest: { ...library('Alpha').latest, sentence: 'Useful\nfor sensors.', architectures: ['esp32', '*', 'esp32'], url: 'private-url' },
    }] });
    assert.equal(result.scope, 'library_index');
    assert.equal(result.query, 'sensor');
    assert.equal(result.profile, 'release');
    assert.equal(result.total, 2);
    assert.equal(result.returned, 2);
    assert.deepEqual(result.libraries.map(value => value.name), ['Alpha', 'Zulu']);
    assert.deepEqual(result.libraries[0].versions, ['1.0.0', '2.0.0']);
    assert.deepEqual(result.libraries[0].architectures, ['*', 'esp32']);
    assert.equal(result.libraries[0].description, 'Useful for sensors.');
    assert.equal(result.libraries[0].latestVersion, '2.0.0');
    assert.doesNotMatch(JSON.stringify(result), /private|token/);
});

test('empty search results are distinct from malformed or incomplete output', () => {
    const empty = buildLibrarySearch(target(), 'none', 20, { status: 'success', libraries: [] });
    assert.equal(empty.complete, true);
    assert.equal(empty.total, 0);
    assert.deepEqual(buildLibrarySearch(target(), 'none', 20, { status: 'success' }).libraries, []);
    const partial = buildLibrarySearch(target(), 'none', 20, { status: 'success', libraries: [], warnings: ['Private filesystem warning'] });
    assert.equal(partial.complete, false);
    assert.equal(partial.truncated, false);
    assert.doesNotMatch(JSON.stringify(partial), /Private filesystem/);
    for (const raw of [{}, { status: 'success', libraries: {} }, { status: 'success', libraries: [null] }, { status: 'success', libraries: [{ name: 'Name', available_versions: '1.0.0' }] },
        { status: 'success', libraries: [library('Name')], warnings: {} }, { status: 'success', libraries: [{ ...library('Name'), latest: { architectures: [5] } }] }]) {
        assert.throws(() => buildLibrarySearch(target(), 'none', 20, raw), invalid);
    }
});

test('failed library matches expose names as suggestions without claiming available versions', () => {
    const result = buildLibrarySearch(target(), 'misspelled', 20, { status: 'failed', libraries: [{ name: 'Suggested library' }] });
    assert.equal(result.complete, false);
    assert.equal(result.suggestionsOnly, true);
    assert.equal(result.libraries[0].name, 'Suggested library');
    assert.deepEqual(result.libraries[0].versions, []);
    assert.equal(result.libraries[0].latestVersion, undefined);
    assert.ok(result.issues.some(issue => issue.code === 'LIBRARY_SEARCH_INCOMPLETE'));
    assert.throws(() => buildLibrarySearch(target(), 'query', 20, { status: 'other', libraries: [] }), invalid);
    assert.throws(() => buildLibrarySearch(target(), 'query', 20, { status: 'success', libraries: [{ name: 'Name only' }] }), invalid);
});

test('search marks result limits and per-library version or description truncation', () => {
    const result = buildLibrarySearch(target(), 'library', 1, { status: 'success', libraries: [library('Zulu'), {
        ...library('Alpha', Array.from({ length: 300 }, (_, index) => `1.0.${index}`)),
        latest: { sentence: 'x'.repeat(2000), version: '1.0.299' },
    }] });
    assert.equal(result.total, 2);
    assert.equal(result.returned, 1);
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.libraries[0].versions.length, 200);
    assert.equal(result.libraries[0].versionsTruncated, true);
    assert.equal(result.libraries[0].description?.length, 1024);
    assert.equal(result.issues.filter(issue => issue.code === 'DISCOVERY_TRUNCATED').length, 1);
});

test('search report remains within 256 KiB after large metadata is normalized', () => {
    const result = buildLibrarySearch(target(), 'library', 100, { status: 'success', libraries: Array.from({ length: 100 }, (_, index) => ({
        ...library(`Library ${index}`, Array.from({ length: 200 }, (_, version) => `${version}.${'1'.repeat(100)}`)),
    })) });
    assert.equal(result.total, 100);
    assert.ok(result.returned < 100);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
});

test('example discovery separates board, referenced platform, and user library examples', () => {
    const raw = { installed_libraries: [
        installed('Zulu', 'user', ['C:\\Libraries\\Zulu\\examples\\Simple']),
        installed('Board', 'platform', ['/packages/core/Board/examples/Basic'], 'vendor:arch@1.2.3'),
        installed('Reference', 'ref-platform', ['/packages/ref/Reference/examples/Basic'], 'dependency:arch@1.0'),
        installed('Wrong board', 'platform', ['/wrong/Example'], 'other:arch@1'),
        installed('IDE', 'ide', ['/ide/Example']),
    ] };
    const all = buildExamples(target(), {}, raw);
    assert.equal(all.scope, 'standard_cli_installations');
    assert.equal(all.profile, 'release');
    assert.equal(all.total, 4);
    assert.deepEqual(all.examples.map(example => example.library), ['Board', 'IDE', 'Reference', 'Zulu']);
    assert.equal(all.examples[3].name, 'Simple');
    assert.deepEqual(buildExamples(target(), { source: 'board' }, raw).examples.map(example => example.library), ['Board', 'Reference']);
    assert.deepEqual(buildExamples(target(), { source: 'libraries' }, raw).examples.map(example => example.library), ['IDE', 'Zulu']);
    assert.deepEqual(buildExamples(target(), { library: 'Zulu' }, raw).examples.map(example => example.library), ['Zulu']);
    assert.equal(buildExamples(target(), { library: 'zulu' }, raw).total, 0);
});

test('library-only examples work without a board and do not read example contents', () => {
    const project = target();
    delete project.fqbn;
    const result = buildExamples(project, { source: 'libraries' }, { installed_libraries: [
        installed('User', 'user', ['/does/not/exist/Example']), installed('Board', 'platform', ['/board/Example'], 'vendor:arch@1'),
    ] });
    assert.equal(result.complete, true);
    assert.equal(result.total, 1);
    assert.equal(result.examples[0].path, '/does/not/exist/Example');
});

test('example warnings, unresolved board origins, and profile caches report partial results', () => {
    const result = buildExamples(target(), {}, { installed_libraries: [
        installed('Unknown', 'platform', ['/unknown/Example']),
        installed('Isolated', 'profile', ['/profile/Example']),
        installed('User', 'user', ['/user/Example']),
    ], warnings: ['private-path'] });
    assert.equal(result.complete, false);
    assert.deepEqual(result.examples.map(example => example.library), ['User']);
    assert.deepEqual(result.issues.map(issue => issue.code), ['CLI_DISCOVERY_INCOMPLETE', 'EXAMPLE_ORIGIN_UNRESOLVED', 'PROFILE_EXAMPLES_EXCLUDED']);
    assert.doesNotMatch(JSON.stringify(result), /private-path|\/profile\/Example/);
});

test('examples normalize duplicates, apply limits, and retain explicit empty results', () => {
    const empty = buildExamples(target(), {}, { installed_libraries: [installed('Empty', 'user')] });
    assert.equal(empty.complete, true);
    assert.equal(empty.total, 0);
    const result = buildExamples(target(), { limit: 1 }, { installed_libraries: [installed('User', 'user', ['/e/Second', '/e/First', '/e/First'])] });
    assert.equal(result.total, 2);
    assert.equal(result.returned, 1);
    assert.equal(result.examples[0].name, 'First');
    assert.equal(result.truncated, true);
    assert.equal(result.complete, false);
});

test('malformed example inventories and invalid output limits are rejected', () => {
    for (const raw of [{}, { installed_libraries: {} }, { installed_libraries: [null] },
        { installed_libraries: [{ library: { name: 'Name', location: 'user', examples: {} } }] },
        { installed_libraries: [installed('Name', 'unknown')] },
        { installed_libraries: [installed('Name', 'user', ['bad\npath'])] }]) {
        assert.throws(() => buildExamples(target(), {}, raw), invalid);
    }
    for (const limit of [0, 101, -1, 1.5, NaN]) {
        assert.throws(() => buildExamples(target(), { limit }, { installed_libraries: [] }), error => error instanceof AiBridgeError && error.code === 'INVALID_ARGUMENT');
        assert.throws(() => buildLibrarySearch(target(), 'query', limit, { status: 'success', libraries: [] }), error => error instanceof AiBridgeError && error.code === 'INVALID_ARGUMENT');
    }
});

test('large example paths are bounded by report bytes as well as item count', () => {
    const result = buildExamples(target(), { source: 'libraries', limit: 100 }, { installed_libraries: [
        installed('Library', 'user', Array.from({ length: 100 }, (_, index) => `/${'folder/'.repeat(1000)}Example${index}`)),
    ] });
    assert.equal(result.total, 100);
    assert.ok(result.returned < 100);
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
});
