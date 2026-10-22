import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiBridgeError, type ProjectInspection } from '../contracts';
import { installLibraryForTarget, type LibraryInstallationOptions } from '../libraryInstallation';
import type { ProcessResult } from '../processRunner';

function target(): ProjectInspection {
    return {
        schemaVersion: 1, sketchPath: '/sketch', sketchName: 'sketch', configurationPath: '/sketch/.vscode/arduino.json',
        fqbn: 'arduino:avr:uno', buildPath: '/sketch/build', buildProperties: [], compileArgs: [], fingerprint: 'initial', buildFingerprint: 'initial',
        canCompile: true, issues: [], availableProfiles: [], declaredDependencies: { platforms: [], libraries: [], issues: [] },
    };
}

const library = (name = 'Sensor', version: string | undefined = '1.2.3', location = 'user') => ({ library: { name, version, location } });
const inventory = (...entries: { library: { name: string; version?: string; location: string } }[]) => ({ installed_libraries: entries });
const index = () => ({ status: 'success', libraries: [{ name: 'Sensor', available_versions: ['1.2.3', '1.2.4'] }] });
const processResult = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
    exitCode: 0, signal: null, stdout: 'Installed Sensor 1.2.3\n', stderr: '', output: '', truncated: false, canceled: false, durationMs: 10, ...overrides,
});
const code = (expected: string) => (error: unknown) => error instanceof AiBridgeError && error.code === expected;

function fixture(overrides: Partial<LibraryInstallationOptions> = {}) {
    const calls: string[][] = [];
    const progress: string[] = [];
    const controller = new AbortController();
    let mutations = 0;
    let lists = 0;
    const options: LibraryInstallationOptions = {
        target: target(), library: 'Sensor', version: '1.2.3', signal: controller.signal,
        progress: value => { progress.push(value.message); }, assertCurrent: () => {},
        query: async args => {
            calls.push(args);
            if (args[1] === 'search') { return index(); }
            return lists++ === 0 ? inventory() : inventory(library());
        },
        run: async args => { calls.push(args); return processResult(); },
        onMutationStarted: () => { mutations++; }, ...overrides,
    };
    return { options, calls, progress, controller, mutations: () => mutations, run: () => installLibraryForTarget(options) };
}

test('library installation uses fixed argv and verifies the exact indexed version in user scope', async () => {
    const f = fixture();
    const result = await f.run();
    assert.deepEqual(f.calls, [
        ['lib', 'list', '--all', '--json'],
        ['lib', 'search', '--omit-releases-details', '--json', '--', 'Sensor'],
        ['lib', 'install', '--', 'Sensor@1.2.3'],
        ['lib', 'list', '--all', '--json'],
    ]);
    assert.equal(result.status, 'success');
    assert.equal(result.outcome, 'installed');
    assert.equal(result.scope, 'user_libraries');
    assert.deepEqual(result.target, { sketchPath: '/sketch' });
    assert.deepEqual(result.previousVersions, []);
    assert.deepEqual(result.installedVersions, ['1.2.3']);
    assert.deepEqual(result.changes, { added: [{ name: 'Sensor', version: '1.2.3' }], removed: [], complete: true });
    assert.equal(result.changesMayHaveOccurred, true);
    assert.equal(f.mutations(), 1);
    assert.ok(f.progress.length >= 4);
    assert.match(result.notes.join(' '), /shared.*replace.*dependencies.*recompilation.*no automatic retry or rollback/);
});

test('the same user version is a no-op without an index lookup or cache invalidation', async () => {
    const f = fixture({ query: async args => { assert.deepEqual(args, ['lib', 'list', '--all', '--json']); return inventory(library()); } });
    const result = await f.run();
    assert.equal(result.status, 'success');
    assert.equal(result.outcome, 'already_installed');
    assert.equal(result.changesMayHaveOccurred, false);
    assert.deepEqual(result.previousVersions, ['1.2.3']);
    assert.deepEqual(result.installedVersions, ['1.2.3']);
    assert.equal(f.mutations(), 0);
    assert.deepEqual(f.calls, []);
});

test('a requested exact version replaces the user copy and reports added dependencies', async () => {
    let lists = 0;
    const f = fixture({ query: async args => args[1] === 'search' ? index() : lists++ === 0
        ? inventory(library('Sensor', '1.2.4'), library('Unchanged', '2.0.0'))
        : inventory(library(), library('Unchanged', '2.0.0'), library('Bus', '3.0.0')) });
    const result = await f.run();
    assert.equal(result.status, 'success');
    assert.deepEqual(result.previousVersions, ['1.2.4']);
    assert.deepEqual(result.changes.removed, [{ name: 'Sensor', version: '1.2.4' }]);
    assert.deepEqual(result.changes.added, [{ name: 'Sensor', version: '1.2.3' }, { name: 'Bus', version: '3.0.0' }]);
});

test('platform, IDE, local and profile copies do not satisfy a user-scope installation', async () => {
    let lists = 0;
    const other = ['ide', 'platform', 'ref-platform', 'unmanaged', 'profile'].map(location => library('Sensor', '1.2.3', location));
    const f = fixture({ query: async args => args[1] === 'search' ? index() : lists++ === 0 ? inventory(...other) : inventory(...other, library()) });
    const result = await f.run();
    assert.equal(result.outcome, 'installed');
    assert.deepEqual(result.previousVersions, []);
    assert.equal(f.mutations(), 1);
    assert.deepEqual(result.changes.added, [{ name: 'Sensor', version: '1.2.3' }]);
});

test('unknown names, unavailable exact versions and search suggestions never install', async () => {
    for (const [metadata, expected] of [
        [{ status: 'success', libraries: [{ name: 'Sensor Plus', available_versions: ['1.2.3'] }] }, 'LIBRARY_NOT_FOUND'],
        [{ status: 'failed', libraries: [{ name: 'Sensor' }] }, 'LIBRARY_NOT_FOUND'],
        [{ status: 'success', libraries: [{ name: 'Sensor', available_versions: ['1.2.4'] }] }, 'LIBRARY_VERSION_NOT_FOUND'],
        [{ status: 'success', libraries: [{ name: 'Sensor', available_versions: ['1.2.3+other'] }] }, 'LIBRARY_VERSION_NOT_FOUND'],
    ] as const) {
        const f = fixture({ query: async args => args[1] === 'search' ? metadata : inventory() });
        await assert.rejects(f.run(), code(expected));
        assert.equal(f.mutations(), 0);
        assert.deepEqual(f.calls, []);
    }
});

test('malformed, warning-bearing and ambiguous preflight inventories never mutate libraries', async () => {
    for (const [raw, expected] of [
        [null, 'INVALID_CLI_OUTPUT'], [{ installed_libraries: {} }, 'INVALID_CLI_OUTPUT'],
        [inventory({ library: { name: 'Sensor', version: '1.2.3', location: 'unknown' } }), 'INVALID_CLI_OUTPUT'],
        [{ ...inventory(), warnings: ['private path'] }, 'LIBRARY_METADATA_INCOMPLETE'],
        [inventory(library(), library('Sensor', '1.2.4')), 'LIBRARY_INSTALLATION_AMBIGUOUS'],
        [inventory({ library: { name: 'Sensor', version: undefined, location: 'user' } }), 'LIBRARY_INSTALLATION_AMBIGUOUS'],
    ] as const) {
        const f = fixture({ query: async () => raw });
        await assert.rejects(f.run(), code(expected));
        assert.equal(f.mutations(), 0);
    }
});

test('malformed, incomplete and ambiguous index entries never reach installation', async () => {
    for (const raw of [
        {}, { ...index(), warnings: ['Initialization failed'] },
        { ...index(), libraries: [...index().libraries, ...index().libraries] },
        { ...index(), libraries: [{ name: 'Sensor', available_versions: '1.2.3' }] },
        { ...index(), libraries: [{ name: 'Sensor', available_versions: [1] }] },
    ]) {
        const f = fixture({ query: async args => args[1] === 'search' ? raw : inventory() });
        await assert.rejects(f.run(), (error: unknown) => error instanceof AiBridgeError);
        assert.equal(f.mutations(), 0);
    }
});

test('profile installation requires a matching declaration and preserves its version pin', async () => {
    const selected = target();
    selected.resolvedProfile = 'release';
    selected.declaredDependencies.libraries = [{ kind: 'index', name: 'Sensor', version: '1.2.3' }];
    const f = fixture({ target: selected });
    const before = JSON.stringify(selected);
    const result = await f.run();
    assert.equal(result.status, 'success');
    assert.equal(result.target.profile, 'release');
    assert.equal(result.scope, 'user_libraries');
    assert.match(result.notes.join(' '), /isolated.*declarations and dependency cache are unchanged/);
    assert.equal(JSON.stringify(selected), before);
});

test('unpinned profile declarations remain unpinned and explicitly distinguish profile compilation', async () => {
    const selected = target();
    selected.resolvedProfile = 'release';
    selected.declaredDependencies.libraries = [{ kind: 'index', name: 'Sensor' }];
    const result = await fixture({ target: selected }).run();
    assert.match(result.notes.join(' '), /may select a different version.*does not add a version pin/);
    assert.deepEqual(selected.declaredDependencies.libraries, [{ kind: 'index', name: 'Sensor' }]);
});

test('profile conflicts, undeclared or local libraries and incomplete declarations reject before CLI work', async () => {
    for (const variant of ['conflict', 'undeclared', 'local', 'incomplete', 'invalid'] as const) {
        const selected = target(); selected.resolvedProfile = 'release';
        if (variant === 'conflict') { selected.declaredDependencies.libraries = [{ kind: 'index', name: 'Sensor', version: '2.0.0' }]; }
        if (variant === 'local') { selected.declaredDependencies.libraries = [{ kind: 'local', directory: '../Sensor' }]; }
        if (variant === 'incomplete') { selected.declaredDependencies.issues.push({ code: 'INVALID_METADATA', message: 'Incomplete' }); }
        if (variant === 'invalid') { selected.issues.push({ code: 'INVALID_YAML', message: 'Invalid YAML' }); }
        const f = fixture({ target: selected });
        await assert.rejects(f.run(), code(variant === 'conflict' ? 'PROFILE_VERSION_CONFLICT'
            : variant === 'incomplete' || variant === 'invalid' ? 'INVALID_PROFILE' : 'PROFILE_LIBRARY_NOT_DECLARED'));
        assert.deepEqual(f.calls, []);
    }
});

test('Arduino normalized versions match while build metadata remains an exact identity', async () => {
    const selected = target(); selected.resolvedProfile = 'release';
    selected.declaredDependencies.libraries = [{ kind: 'index', name: 'Sensor', version: '1.2' }];
    const f = fixture({ target: selected, version: '1.2.0', query: async () => inventory(library('Sensor', '1.2')) });
    assert.equal((await f.run()).outcome, 'already_installed');
    selected.declaredDependencies.libraries = [{ kind: 'index', name: 'Sensor', version: '1.2.0+one' }];
    await assert.rejects(fixture({ target: selected, version: '1.2.0+two' }).run(), code('PROFILE_VERSION_CONFLICT'));
});

test('invalid package and version arguments cannot become CLI options or paths', async () => {
    for (const [name, version] of [['--git-url', '1.2.3'], ['../Sensor', '1.2.3'], ['Sensor@1.2.3', '1.2.3'],
        ['https://example.com/Sensor.zip', '1.2.3'], ['Sensor', 'latest'], ['Sensor', '>=1.2.3'], ['Sensor', '1.2.3 --no-deps']]) {
        const f = fixture({ library: name, version });
        await assert.rejects(f.run(), code('INVALID_ARGUMENTS'));
        assert.deepEqual(f.calls, []);
    }
});

test('pre-cancellation and context changes during preflight stop before mutation', async () => {
    const canceled = fixture(); canceled.controller.abort();
    await assert.rejects(canceled.run(), code('CANCELED'));
    assert.deepEqual(canceled.calls, []);
    let stale = false;
    const f = fixture({
        query: async () => { stale = true; return inventory(); },
        assertCurrent: () => { if (stale) { throw new AiBridgeError('STALE_TARGET', 'Target changed'); } },
    });
    await assert.rejects(f.run(), code('STALE_TARGET'));
    assert.equal(f.mutations(), 0);
});

test('download failures preserve process output and report partially installed dependencies', async () => {
    let lists = 0;
    const f = fixture({
        query: async args => args[1] === 'search' ? index() : lists++ === 0 ? inventory() : inventory(library('Bus', '3.0.0')),
        run: async () => processResult({ exitCode: 1, stdout: 'Installed Bus 3.0.0\n', stderr: 'Download failed\n' }),
    });
    const result = await f.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.outcome, 'unverified');
    assert.equal(result.error?.code, 'LIBRARY_INSTALL_FAILED');
    assert.equal(result.changesMayHaveOccurred, true);
    assert.deepEqual(result.changes.added, [{ name: 'Bus', version: '3.0.0' }]);
    assert.deepEqual(result.installedVersions, []);
    assert.match(result.stderr, /Download failed/);
});

test('a zero exit code without the requested user library is not reported as success', async () => {
    const f = fixture({ query: async args => args[1] === 'search' ? index() : inventory() });
    const result = await f.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'LIBRARY_INSTALL_NOT_VERIFIED');
    assert.equal(result.changes.complete, true);
    assert.deepEqual(result.installedVersions, []);
});

test('cancellation after installation starts returns mutation uncertainty without another process', async () => {
    const f = fixture();
    f.options.run = async () => { f.controller.abort(); return processResult({ canceled: true, exitCode: null, stdout: 'Installing...\n' }); };
    const result = await f.run();
    assert.equal(result.status, 'canceled');
    assert.equal(result.error?.code, 'CANCELED');
    assert.equal(result.changesMayHaveOccurred, true);
    assert.equal(result.installedVersions, null);
    assert.equal(result.changes.complete, false);
    assert.equal(f.calls.length, 2);
    assert.match(result.stdout, /Installing/);
});

test('trust loss and target changes after mutation retain facts and suppress verification queries', async () => {
    for (const errorCode of ['WORKSPACE_UNTRUSTED', 'STALE_TARGET']) {
        let current = true;
        const f = fixture({
            assertCurrent: () => { if (!current) { throw new AiBridgeError(errorCode, 'Context changed'); } },
            run: async () => { current = false; return processResult(); },
        });
        const result = await f.run();
        assert.equal(result.status, 'failed');
        assert.equal(result.error?.code, errorCode);
        assert.equal(result.changesMayHaveOccurred, true);
        assert.equal(result.installedVersions, null);
        assert.match(result.stdout, /Installed Sensor/);
        assert.equal(f.calls.length, 2);
    }
});

test('post-install warnings and query failures never claim verified installation', async () => {
    for (const shouldThrow of [false, true]) {
        let lists = 0;
        const f = fixture({ query: async args => {
            if (args[1] === 'search') { return index(); }
            if (lists++ === 0) { return inventory(); }
            if (shouldThrow) { throw new Error('private unexpected failure'); }
            return { ...inventory(library()), warnings: ['private filesystem issue'] };
        } });
        const result = await f.run();
        assert.equal(result.status, 'failed');
        assert.equal(result.installedVersions, null);
        assert.equal(result.changesMayHaveOccurred, true);
        assert.doesNotMatch(JSON.stringify(result), /private/);
    }
});

test('unexpected process exceptions are structured after mutation and can still report observed changes', async () => {
    const f = fixture({ run: async () => { throw new Error('private unexpected exception'); } });
    const result = await f.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'LIBRARY_INSTALL_FAILED');
    assert.deepEqual(result.installedVersions, ['1.2.3']);
    assert.equal(result.changesMayHaveOccurred, true);
    assert.doesNotMatch(JSON.stringify(result), /private unexpected exception/);
});

test('structured changes and output remain bounded even with many dependencies and escaped output', async () => {
    let lists = 0;
    const f = fixture({
        query: async args => args[1] === 'search' ? index() : lists++ === 0 ? inventory()
            : inventory(library(), ...Array.from({ length: 1000 }, (_, number) => library(`Dependency ${number} ${'x'.repeat(450)}`))),
        run: async () => processResult({ stdout: '\u0000'.repeat(200000), stderr: '\u0001'.repeat(200000) }),
    });
    const result = await f.run();
    assert.equal(result.status, 'success');
    assert.equal(result.truncated, true);
    assert.equal(result.changes.complete, false);
    assert.ok(result.changes.added.length <= 500);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
});

test('many duplicate versions in a post-install inventory remain bounded and cannot verify installation', async () => {
    let lists = 0;
    const f = fixture({ query: async args => args[1] === 'search' ? index() : lists++ === 0 ? inventory()
        : inventory(...Array.from({ length: 20000 }, (_, number) => library('Sensor', `1.2.${number}+${'x'.repeat(100)}`))) });
    const result = await f.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'LIBRARY_INSTALL_NOT_VERIFIED');
    assert.equal(result.truncated, true);
    assert.equal(result.installedVersionsTruncated, true);
    assert.ok(result.installedVersions!.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
});
