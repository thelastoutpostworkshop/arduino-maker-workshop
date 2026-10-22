import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiBridgeError, AiDiscoveryQuery, AiOperationResult, AiToolInput, AiToolName, ProjectInspection } from '../contracts';
import { AiOperationDependencies, createAiOperationHandler } from '../operations';
import { collectSensitiveValues, redactForAssistant, redactText } from '../redaction';
import type { BacktraceDecodeResult } from '../backtrace';
import type { LibraryInstallationResult } from '../libraryInstallation';

function fixture(overrides: Partial<AiOperationDependencies> = {}) {
    const target: ProjectInspection = {
        schemaVersion: 1, sketchPath: '/sketch', sketchName: 'sketch', configurationPath: '/sketch/.vscode/arduino.json',
        fqbn: 'arduino:avr:uno', buildPath: '/sketch/build', buildProperties: ['build.extra_flags=-DWIFI_PASSWORD="private password"'],
        compileArgs: ['compile', '--build-property', 'build.extra_flags=-DWIFI_PASSWORD="private password"'], fingerprint: 'initial', buildFingerprint: 'initial', canCompile: true, issues: [],
        availableProfiles: [], declaredDependencies: { platforms: [], libraries: [], issues: [] },
    };
    let compiles = 0;
    let invalidated = 0;
    const result = (): AiOperationResult => ({
        schemaVersion: 1, operationId: 'operation-1', status: 'success', target, exitCode: 0,
        stdout: 'value private password', stderr: '', truncated: false, durationMs: 1, cliVersion: 'test',
        dependencies: { status: 'available', libraries: [{ name: 'Sensor', version: '1.0.0', path: '/libraries/private password' }],
            platforms: [{ id: 'arduino:avr', version: '1.8.6', path: '/arduino/avr' }], notes: [] },
        diagnostics: { status: 'available', items: [{ severity: 'warning', message: 'value private password', file: '/sketch/sketch.ino', line: 4 }], notes: [] },
        memory: { status: 'available', flash: { usedBytes: 100, maxBytes: 1000, percent: 10 }, ram: { usedBytes: 20, maxBytes: 200, percent: 10 }, notes: [] },
        artifacts: { status: 'available', files: [{ path: '/sketch/build/sketch.ino.elf', relativePath: 'sketch.ino.elf', kind: 'elf', sizeBytes: 42 }], notes: [] },
    });
    const dependencies: AiOperationDependencies = {
        isTrusted: () => true, activeSketchPath: () => '/sketch', isReady: () => true,
        inspect: () => target, cliInfo: () => ({ executable: '/tools/arduino-cli', version: 'test' }),
        hasUnsavedSketchDocuments: () => false, revision: () => 0,
        compile: async () => { compiles++; return result(); },
        decode: async () => { throw new Error('Unexpected decoder invocation.'); },
        install: async () => { throw new Error('Unexpected library installation.'); },
        discover: async () => ({ boards: [], password: 'hidden' }),
        query: async () => ({ installed_libraries: [] }),
        invalidateBuild: () => { invalidated++; }, ...overrides,
    };
    return { target, dependencies, handler: createAiOperationHandler(dependencies), compiles: () => compiles, invalidated: () => invalidated };
}

function call(f: ReturnType<typeof fixture>, tool: Parameters<typeof f.handler>[0] = 'compile_sketch', signal = new AbortController().signal) {
    return f.handler(tool, { sketchPath: '/sketch' }, signal, () => {});
}

function code(expected: string) {
    return (error: unknown) => error instanceof AiBridgeError && error.code === expected;
}

test('context is observational and redacts internal compile properties and arguments', async () => {
    const f = fixture({ isReady: () => false, compile: async () => { throw new Error('must not execute'); } });
    const context = await call(f, 'get_project_context') as { ready: boolean };
    assert.equal(context.ready, false);
    assert.ok(!JSON.stringify(context).includes('private password'));
    assert.ok(JSON.stringify(context).includes('<redacted>'));
    assert.equal(f.compiles(), 0);
});

test('backend allowlist, trust, readiness, scope and pre-cancellation reject before execution', async () => {
    await assert.rejects(call(fixture(), 'upload' as never), code('TOOL_NOT_ALLOWED'));
    await assert.rejects(call(fixture({ isTrusted: () => false }), 'get_project_context'), code('WORKSPACE_UNTRUSTED'));
    await assert.rejects(call(fixture({ isReady: () => false })), code('CLI_NOT_READY'));
    await assert.rejects(call(fixture({ activeSketchPath: () => undefined })), code('NO_ACTIVE_SKETCH'));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(call(fixture(), 'compile_sketch', abort.signal), code('CANCELED'));
});

test('discovery returns sanitized structured data without starting compilation', async () => {
    const f = fixture();
    assert.deepEqual(await call(f, 'list_ports'), { boards: [], password: '<redacted>' });
    assert.equal(f.compiles(), 0);
});

test('dependency inventory uses fixed queries, selected declarations and no compilation', async () => {
    const queried: string[] = [];
    const f = fixture({
        discover: async (kind) => {
            queried.push(kind);
            return kind === 'cores' ? { platforms: [{ id: 'arduino:avr', installed_version: '1.8.6' }] }
                : { installed_libraries: [{ library: { name: 'ArduinoJson', version: '7.3.0', properties: { secret: 'hidden' } } }] };
        },
    });
    f.target.resolvedProfile = 'release';
    f.target.declaredDependencies.libraries = [{ kind: 'index', name: 'ArduinoJson', version: '7.3.0' }];
    const inspect = f.dependencies.inspect;
    f.dependencies.inspect = (input, activePath) => {
        assert.equal(input.profile, 'release');
        return inspect(input, activePath);
    };
    const report = await f.handler('list_dependencies', { sketchPath: '/sketch', profile: 'release' }, new AbortController().signal, () => {}) as {
        profile: string; comparison: { libraries: { status: string }[] }; buildResolved: { status: string };
    };
    assert.deepEqual(queried, ['cores', 'libraries']);
    assert.equal(report.profile, 'release');
    assert.equal(report.comparison.libraries[0].status, 'installed');
    assert.equal(report.buildResolved.status, 'not_reported');
    assert.doesNotMatch(JSON.stringify(report), /hidden|properties/);
    assert.equal(f.compiles(), 0);
});

test('dependency inventory is available before a compilable board is selected', async () => {
    const f = fixture({ discover: async kind => kind === 'cores' ? { platforms: [] } : { installed_libraries: [] } });
    f.target.canCompile = false;
    f.target.issues = [{ code: 'BOARD_REQUIRED', message: 'Select a board.' }];
    const report = await call(f, 'list_dependencies') as { installed: { complete: boolean }; declared: unknown };
    assert.equal(report.installed.complete, true);
    assert.deepEqual(report.declared, { platforms: [], libraries: [], issues: [] });
    assert.equal(f.compiles(), 0);
});

test('dependency inventory enforces readiness, trust and pre-cancellation before queries', async () => {
    const noQueries = async () => { assert.fail('Inventory must not run'); };
    await assert.rejects(call(fixture({ discover: noQueries, isReady: () => false }), 'list_dependencies'), code('CLI_NOT_READY'));
    await assert.rejects(call(fixture({ discover: noQueries, isTrusted: () => false }), 'list_dependencies'), code('WORKSPACE_UNTRUSTED'));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(call(fixture({ discover: noQueries }), 'list_dependencies', abort.signal), code('CANCELED'));
});

test('dependency queries stop on cancellation or trust revocation at either stage', async () => {
    for (const stopAt of ['cores', 'libraries']) {
        for (const failure of ['CANCELED', 'WORKSPACE_UNTRUSTED']) {
            const abort = new AbortController();
            let trusted = true;
            const queries: string[] = [];
            const f = fixture({
                isTrusted: () => trusted,
                discover: async kind => {
                    queries.push(kind);
                    if (kind === stopAt) {
                        if (failure === 'CANCELED') { abort.abort(); } else { trusted = false; }
                    }
                    return kind === 'cores' ? { platforms: [] } : { installed_libraries: [] };
                },
            });
            await assert.rejects(call(f, 'list_dependencies', abort.signal), code(failure));
            assert.deepEqual(queries, stopAt === 'cores' ? ['cores'] : ['cores', 'libraries']);
            assert.equal(f.compiles(), 0);
        }
    }
});

test('dependency discovery errors and invalid inventory never become a complete report', async () => {
    const queries: string[] = [];
    const f = fixture({ discover: async kind => { queries.push(kind); throw new AiBridgeError('CLI_FAILED', 'Inventory failed.'); } });
    await assert.rejects(call(f, 'list_dependencies'), code('CLI_FAILED'));
    assert.deepEqual(queries, ['cores']);
    await assert.rejects(call(fixture(), 'list_dependencies'), code('INVALID_CLI_OUTPUT'));
});

test('dependency declarations and available profile metadata share credential redaction', async () => {
    const f = fixture({ discover: async kind => kind === 'cores' ? { platforms: [] } : { installed_libraries: [] } });
    f.target.declaredDependencies.platforms = [{ id: 'vendor:core', indexUrl: 'https://example.invalid/index.json?token=hidden' }];
    f.target.availableProfiles = [{ name: 'release', isDefault: true, isSelected: true, issues: [], dependencies: f.target.declaredDependencies }];
    for (const name of ['get_project_context', 'list_dependencies'] as const) {
        const result = JSON.stringify(await call(f, name));
        assert.doesNotMatch(result, /hidden|private password/);
        assert.match(result, /<redacted>/);
    }
});

function discoveryResponse(query: AiDiscoveryQuery): unknown {
    if (query.kind === 'boardDetails') {
        return { name: 'Test board', fqbn: query.fqbn, config_options: [
            { option: 'speed', option_label: 'Speed', values: [
                { value: 'slow', value_label: 'Slow', selected: true }, { value: 'fast', value_label: 'Fast' },
            ] },
        ], build_properties: ['password=do-not-export'] };
    }
    if (query.kind === 'librarySearch') { return { status: 'success', libraries: [] }; }
    return { installed_libraries: [] };
}

test('discovery uses the requested profile, base board defaults, scoped examples and normalized search', async () => {
    const queries: AiDiscoveryQuery[] = [];
    const inspected: AiToolInput[] = [];
    const f = fixture({ query: async query => { queries.push(query); return discoveryResponse(query); } });
    f.target.fqbn = 'vendor:arch:board:speed=fast';
    f.target.resolvedProfile = 'release';
    f.target.selectedProfile = 'release';
    f.target.canCompile = false; // Discovery does not need a compilable output directory or dependency set.
    f.dependencies.inspect = input => { inspected.push(input); return f.target; };
    const input = { sketchPath: '/sketch', profile: 'release' };
    const board = await f.handler('get_board_details', input, new AbortController().signal, () => {}) as {
        profile: string; board: { options: { defaultValue: string; selectedValue: string }[] };
    };
    assert.equal(board.profile, 'release');
    assert.equal(board.board.options[0].defaultValue, 'slow');
    assert.equal(board.board.options[0].selectedValue, 'fast');
    assert.doesNotMatch(JSON.stringify(board), /do-not-export|build_properties/);
    await f.handler('list_examples', { ...input, source: 'all', library: ' Wire ', limit: 3 }, new AbortController().signal, () => {});
    await f.handler('list_examples', { ...input, source: 'libraries' }, new AbortController().signal, () => {});
    await f.handler('search_libraries', { ...input, query: ' sensor ', limit: 2 }, new AbortController().signal, () => {});
    assert.deepEqual(queries, [
        { kind: 'boardDetails', sketchPath: '/sketch', fqbn: 'vendor:arch:board' },
        { kind: 'examples', sketchPath: '/sketch', fqbn: 'vendor:arch:board:speed=fast' },
        { kind: 'examples', sketchPath: '/sketch' },
        { kind: 'librarySearch', sketchPath: '/sketch', query: 'sensor' },
    ]);
    assert.ok(inspected.every(value => JSON.stringify(value) === JSON.stringify(input)), 'Only inspection fields reach the project reader');
    assert.equal(f.target.fqbn, 'vendor:arch:board:speed=fast');
    assert.equal(f.compiles(), 0);
});

test('library discovery remains available without a board while board discovery rejects unresolved targets', async () => {
    let queries = 0;
    const f = fixture({ query: async query => { queries++; return discoveryResponse(query); } });
    f.target.fqbn = undefined;
    f.target.canCompile = false;
    f.target.issues = [{ code: 'FQBN_REQUIRED', message: 'Select a board.' }];
    await f.handler('search_libraries', { sketchPath: '/sketch', query: 'sensor' }, new AbortController().signal, () => {});
    await f.handler('list_examples', { sketchPath: '/sketch', source: 'libraries' }, new AbortController().signal, () => {});
    assert.equal(queries, 2);
    await assert.rejects(call(f, 'get_board_details'), code('INVALID_TARGET'));
    await assert.rejects(call(f, 'list_examples'), code('INVALID_TARGET'));
    f.target.fqbn = 'vendor:arch:board';
    f.target.issues = [{ code: 'PROFILE_NOT_FOUND', message: 'No selected profile.' }];
    await assert.rejects(call(f, 'get_board_details'), code('INVALID_TARGET'));
    assert.equal(queries, 2);
});

const discoveryCalls: { name: AiToolName; input: AiToolInput }[] = [
    { name: 'get_board_details', input: { sketchPath: '/sketch' } },
    { name: 'search_libraries', input: { sketchPath: '/sketch', query: 'sensor' } },
    { name: 'list_examples', input: { sketchPath: '/sketch' } },
];

test('new discovery validates arguments and rejects unavailable sessions before querying', async () => {
    const noQueries = async () => { assert.fail('Discovery must not run'); };
    const f = fixture({ query: noQueries });
    await assert.rejects(f.handler('search_libraries', { sketchPath: '/sketch', query: ' ' }, new AbortController().signal, () => {}), code('INVALID_ARGUMENTS'));
    await assert.rejects(f.handler('list_examples', { sketchPath: '/sketch', limit: 101 }, new AbortController().signal, () => {}), code('INVALID_ARGUMENTS'));
    for (const { name, input } of discoveryCalls) {
        for (const [overrides, expected] of [
            [{ isReady: () => false }, 'CLI_NOT_READY'], [{ isTrusted: () => false }, 'WORKSPACE_UNTRUSTED'],
        ] as const) {
            const unavailable = fixture({ ...overrides, query: noQueries });
            await assert.rejects(unavailable.handler(name, input, new AbortController().signal, () => {}), code(expected));
        }
        const abort = new AbortController(); abort.abort();
        await assert.rejects(f.handler(name, input, abort.signal, () => {}), code('CANCELED'));
    }
});

test('new discovery rejects cancellation, revoked trust and changed sketch/target after a query', async () => {
    for (const { name, input } of discoveryCalls) {
        for (const expected of ['CANCELED', 'WORKSPACE_UNTRUSTED', 'STALE_TARGET', 'changed-board']) {
            const abort = new AbortController(); let trusted = true; let active = '/sketch';
            const f = fixture({ isTrusted: () => trusted, activeSketchPath: () => active,
                query: async query => {
                    if (expected === 'CANCELED') { abort.abort(); }
                    if (expected === 'WORKSPACE_UNTRUSTED') { trusted = false; }
                    if (expected === 'STALE_TARGET') { active = '/other-sketch'; }
                    if (expected === 'changed-board') { f.target.fqbn = 'vendor:arch:changed'; }
                    return discoveryResponse(query);
                } });
            f.dependencies.inspect = () => ({ ...f.target });
            await assert.rejects(f.handler(name, input, abort.signal, () => {}), code(expected === 'changed-board' ? 'STALE_TARGET' : expected));
        }
    }
});

test('discovery serializes window CLI operations and releases its lock on errors', async () => {
    let finish!: () => void;
    const f = fixture({ query: async query => {
        await new Promise<void>(resolve => { finish = resolve; });
        return discoveryResponse(query);
    } });
    const pending = call(f, 'get_board_details');
    await assert.rejects(call(f), code('BUSY'));
    await assert.rejects(call(f, 'list_dependencies'), code('BUSY'));
    await assert.rejects(call(f, 'list_ports'), code('BUSY'));
    await assert.rejects(call(f, 'list_examples'), code('BUSY'));
    await call(f, 'get_project_context');
    finish(); await pending;
    f.dependencies.query = async () => { throw new AiBridgeError('CLI_FAILED', 'Discovery failed.'); };
    await assert.rejects(call(f, 'get_board_details'), code('CLI_FAILED'));
    await call(f);
    assert.equal(f.compiles(), 1);
});

test('compilation prevents assistant discovery in the same window without interrupting the build', async () => {
    let finish!: () => void;
    const f = fixture();
    const compile = f.dependencies.compile;
    f.dependencies.compile = async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return compile(...args); };
    const pending = call(f);
    for (const { name, input } of discoveryCalls) {
        await assert.rejects(f.handler(name, input, new AbortController().signal, () => {}), code('BUSY'));
    }
    finish(); await pending;
    assert.equal(f.compiles(), 1);
});

test('all new discovery reports redact known project credentials after normalization', async () => {
    const f = fixture({ query: async query => {
        if (query.kind === 'boardDetails') { return { name: 'private password', fqbn: query.fqbn }; }
        if (query.kind === 'librarySearch') {
            return { status: 'success', libraries: [{ name: 'Example', available_versions: ['1.0'],
                latest: { version: '1.0', sentence: 'private password' } }] };
        }
        return { installed_libraries: [{ library: { name: 'Example', location: 'user', examples: ['/private password/Example'] } }] };
    } });
    for (const { name, input } of discoveryCalls) {
        const result = JSON.stringify(await f.handler(name, input, new AbortController().signal, () => {}));
        assert.doesNotMatch(result, /private password/);
        assert.match(result, /<redacted>/);
    }
});

test('normal and clean compilation start automatically and return redacted completion', async () => {
    for (const clean of [false, true]) {
        const f = fixture();
        const inspect = f.dependencies.inspect;
        f.dependencies.inspect = (input, activePath) => {
            assert.equal(input.clean, clean);
            return inspect(input, activePath);
        };
        const compiling = f.handler('compile_sketch', { sketchPath: '/sketch', clean }, new AbortController().signal, () => {});
        assert.equal(f.compiles(), 1, 'compilation must start without waiting for approval');
        const result = await compiling as AiOperationResult;
        assert.equal(result.status, 'success');
        assert.equal(result.exitCode, 0);
        assert.equal(result.memory.status, 'available');
        assert.equal(result.artifacts.files.length, 1);
        assert.equal(result.diagnostics.items[0].message, 'value <redacted>');
        assert.equal(result.dependencies.libraries[0].path, '/libraries/<redacted>');
        assert.ok(!JSON.stringify(result).includes('private password'));
    }
});

test('dirty and invalid targets never execute', async () => {
    const dirty = fixture({ hasUnsavedSketchDocuments: () => true });
    await assert.rejects(call(dirty), code('UNSAVED_DOCUMENTS'));
    const invalid = fixture(); invalid.target.canCompile = false;
    await assert.rejects(call(invalid), code('INVALID_TARGET'));
    assert.equal(dirty.compiles() + invalid.compiles(), 0);
});

test('target and executable changes during preflight invalidate the request', async () => {
    const changed = fixture();
    // Return immutable inspection snapshots as the real inspector does.
    const original = { ...changed.target };
    changed.target.fingerprint = 'changed';
    let inspections = 0;
    changed.dependencies.inspect = () => ++inspections === 1 ? original : changed.target;
    await assert.rejects(call(changed), code('STALE_TARGET'));
    const executable = fixture();
    let toolchainReads = 0;
    executable.dependencies.cliInfo = () => ({ executable: ++toolchainReads === 1 ? '/tools' : '/other', version: 'test' });
    await assert.rejects(call(executable), code('STALE_TARGET'));
    assert.equal(changed.compiles() + executable.compiles(), 0);
});

test('cancellation and lost trust during preflight cannot start compilation', async () => {
    const abort = new AbortController();
    const canceled = fixture();
    await assert.rejects(canceled.handler('compile_sketch', { sketchPath: '/sketch' }, abort.signal, () => abort.abort()), code('CANCELED'));
    let trusted = true;
    const revoked = fixture({ isTrusted: () => trusted });
    await assert.rejects(revoked.handler('compile_sketch', { sketchPath: '/sketch' }, new AbortController().signal, () => { trusted = false; }), code('WORKSPACE_UNTRUSTED'));
    assert.equal(canceled.compiles() + revoked.compiles(), 0);
});

test('concurrent compiles are rejected while compilation is running and lock is released', async () => {
    let finish!: () => void;
    const f = fixture();
    const compile = f.dependencies.compile;
    f.dependencies.compile = async (...args) => {
        await new Promise<void>(resolve => { finish = resolve; });
        return compile(...args);
    };
    const pending = call(f);
    await assert.rejects(call(f), code('BUSY'));
    finish();
    assert.equal((await pending as AiOperationResult).status, 'success');
    f.dependencies.compile = async () => { throw new Error('compiler failed'); };
    await assert.rejects(call(f), /compiler failed/);
    f.dependencies.compile = compile;
    assert.equal((await call(f) as AiOperationResult).status, 'success');
});

test('source changes and invalid metadata during compilation invalidate successful artifacts', async () => {
    let revision = 0;
    const f = fixture({ revision: () => revision });
    const compile = f.dependencies.compile;
    f.dependencies.compile = async (...args) => { const result = await compile(...args); revision++; return result; };
    const result = await call(f) as AiOperationResult;
    assert.equal(result.error?.code, 'STALE_INPUT');
    assert.equal(result.memory.status, 'unavailable');
    assert.equal(result.memory.flash, undefined);
    assert.equal(result.dependencies.status, 'unavailable');
    assert.deepEqual(result.dependencies.libraries, []);
    assert.deepEqual(result.dependencies.platforms, []);
    assert.equal(result.artifacts.status, 'unavailable');
    assert.deepEqual(result.artifacts.files, []);
    assert.equal(result.diagnostics.items.length, 1, 'diagnostics still describe the attempted build');
    assert.equal(f.invalidated(), 1);
    const missing = fixture();
    let compiled = false;
    const run = missing.dependencies.compile;
    missing.dependencies.compile = async (...args) => { const value = await run(...args); compiled = true; return value; };
    missing.dependencies.inspect = () => { if (compiled) { throw new Error('removed'); } return missing.target; };
    assert.equal((await call(missing) as AiOperationResult).status, 'failed');
    assert.equal(missing.invalidated(), 1);
    let dirty = false;
    const unsaved = fixture({ hasUnsavedSketchDocuments: () => dirty });
    const originalCompile = unsaved.dependencies.compile;
    unsaved.dependencies.compile = async (...args) => { const value = await originalCompile(...args); dirty = true; return value; };
    assert.equal((await call(unsaved) as AiOperationResult).error?.code, 'STALE_INPUT');
});

function decoded(target: ProjectInspection): BacktraceDecodeResult {
    return { schemaVersion: 1, status: 'success', target: { sketchPath: target.sketchPath, fqbn: target.fqbn!,
        buildPath: target.buildPath, ...(target.resolvedProfile ? { profile: target.resolvedProfile } : {}) },
        architecture: 'xtensa', elfPath: '/sketch/build/sketch.ino.elf', decoderPath: '/tools/addr2line',
        frames: [{ address: '0x40001234', functionName: 'private password', file: '/sketch/sketch.ino', line: 7 }],
        stdout: 'private password', stderr: '', truncated: false, durationMs: 1, notes: [] };
}

function installed(target: ProjectInspection): LibraryInstallationResult {
    return {
        schemaVersion: 1, status: 'success', outcome: 'installed', scope: 'user_libraries',
        target: { sketchPath: target.sketchPath, ...(target.resolvedProfile ? { profile: target.resolvedProfile } : {}) },
        library: 'Sensor Library', version: '2.0.0', previousVersions: ['1.0.0'], installedVersions: ['2.0.0'],
        changesMayHaveOccurred: true,
        changes: { added: [{ name: 'Sensor Library', version: '2.0.0' }], removed: [{ name: 'Sensor Library', version: '1.0.0' }], complete: true },
        exitCode: 0, stdout: 'private password', stderr: '', truncated: false, durationMs: 1, notes: ['private password'],
    };
}

const installationInput = { sketchPath: '/sketch', library: 'Sensor Library', version: '2.0.0' };

test('installation routes exact package, version and profile and redacts structured completion', async () => {
    let installs = 0;
    const f = fixture({ install: async (target, library, version, _signal, progress, assertCurrent) => {
        installs++;
        assert.equal(library, 'Sensor Library');
        assert.equal(version, '2.0.0');
        assert.equal(target.resolvedProfile, 'release');
        assertCurrent();
        progress({ message: 'Installing the requested indexed library.' });
        return installed(target);
    } });
    f.target.resolvedProfile = 'release';
    const inspected: unknown[] = [];
    f.dependencies.inspect = input => { inspected.push(input); return f.target; };
    const messages: string[] = [];
    const result = await f.handler('install_library', { ...installationInput, profile: 'release' }, new AbortController().signal,
        value => messages.push(value.message)) as LibraryInstallationResult;
    assert.equal(result.status, 'success');
    assert.equal(result.target.profile, 'release');
    assert.equal(result.scope, 'user_libraries');
    assert.deepEqual(result.installedVersions, ['2.0.0']);
    assert.equal(result.stdout, '<redacted>');
    assert.deepEqual(result.notes, ['<redacted>']);
    assert.ok(inspected.every(input => JSON.stringify(input) === JSON.stringify({ sketchPath: '/sketch', profile: 'release' })));
    assert.ok(messages.includes('Installing the requested indexed library.'));
    assert.equal(installs, 1);
    assert.equal(f.compiles(), 0);
});

test('installation does not require a board but enforces readiness, trust, dirty files and cancellation', async () => {
    const f = fixture({ install: async target => installed(target) });
    f.target.fqbn = undefined;
    f.target.canCompile = false;
    f.target.issues = [{ code: 'FQBN_REQUIRED', message: 'Select a board before compiling.' }];
    assert.equal((await f.handler('install_library', installationInput, new AbortController().signal, () => {}) as LibraryInstallationResult).status, 'success');
    for (const [overrides, expected] of [
        [{ isTrusted: () => false }, 'WORKSPACE_UNTRUSTED'], [{ isReady: () => false }, 'CLI_NOT_READY'],
        [{ hasUnsavedSketchDocuments: () => true }, 'UNSAVED_DOCUMENTS'],
    ] as [Partial<AiOperationDependencies>, string][]) {
        const blocked = fixture({ ...overrides, install: async () => assert.fail('Installation must not execute.') });
        await assert.rejects(blocked.handler('install_library', installationInput, new AbortController().signal, () => {}), code(expected));
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.handler('install_library', installationInput, controller.signal, () => {}), code('CANCELED'));
});

test('installation holds the shared operation lock until cancellation or failure completes', async () => {
    let finish!: () => void;
    const controller = new AbortController();
    const f = fixture({ install: async target => {
        await new Promise<void>(resolve => { finish = resolve; });
        return installed(target);
    } });
    const pending = f.handler('install_library', installationInput, controller.signal, () => {});
    await assert.rejects(call(f), code('BUSY'));
    await assert.rejects(call(f, 'list_ports'), code('BUSY'));
    await assert.rejects(f.handler('decode_esp32_backtrace', { sketchPath: '/sketch', log: 'PC: 0x40001234' }, new AbortController().signal, () => {}), code('BUSY'));
    await assert.rejects(f.handler('install_library', installationInput, new AbortController().signal, () => {}), code('BUSY'));
    await call(f, 'get_project_context');
    controller.abort(); finish();
    const canceled = await pending as LibraryInstallationResult;
    assert.equal(canceled.status, 'canceled');
    assert.equal(canceled.error?.code, 'CANCELED');
    assert.deepEqual(canceled.installedVersions, ['2.0.0'], 'Cancellation cannot erase observed installed files.');
    f.dependencies.install = async () => { throw new AiBridgeError('LIBRARY_NOT_FOUND', 'No indexed package matched.'); };
    await assert.rejects(f.handler('install_library', installationInput, new AbortController().signal, () => {}), code('LIBRARY_NOT_FOUND'));
    assert.equal((await call(f) as AiOperationResult).status, 'success');

    const compile = f.dependencies.compile;
    f.dependencies.compile = async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return compile(...args); };
    const compiling = call(f);
    await assert.rejects(f.handler('install_library', installationInput, new AbortController().signal, () => {}), code('BUSY'));
    finish(); await compiling;
});

test('installation guard rejects context changes at asynchronous preflight boundaries before mutation', async () => {
    for (const change of ['source', 'profile', 'toolchain', 'active', 'trust', 'dirty', 'readiness', 'cancellation']) {
        let revision = 0, trusted = true, dirty = false, ready = true, version = 'initial', active = '/sketch', mutations = 0;
        const controller = new AbortController();
        const f = fixture({ revision: () => revision, isTrusted: () => trusted, hasUnsavedSketchDocuments: () => dirty,
            cliInfo: () => ({ executable: '/tools/cli', version }), activeSketchPath: () => active, isReady: () => ready });
        f.dependencies.inspect = () => ({ ...f.target });
        f.dependencies.install = async (target, _library, _version, _signal, _progress, assertCurrent) => {
            await Promise.resolve();
            if (change === 'source') { revision++; }
            if (change === 'profile') { f.target.fingerprint = 'changed'; }
            if (change === 'toolchain') { version = 'changed'; }
            if (change === 'active') { active = '/other-sketch'; }
            if (change === 'trust') { trusted = false; }
            if (change === 'dirty') { dirty = true; }
            if (change === 'readiness') { ready = false; }
            if (change === 'cancellation') { controller.abort(); }
            assertCurrent();
            mutations++;
            return installed(target);
        };
        const expected = change === 'trust' ? 'WORKSPACE_UNTRUSTED' : change === 'dirty' ? 'UNSAVED_DOCUMENTS'
            : change === 'readiness' ? 'CLI_NOT_READY' : change === 'cancellation' ? 'CANCELED' : 'STALE_INPUT';
        await assert.rejects(f.handler('install_library', installationInput, controller.signal, () => {}), code(expected));
        assert.equal(mutations, 0);
    }
});

test('installation completion preserves mutation facts when source, trust or saved documents change', async () => {
    for (const change of ['source', 'trust', 'dirty']) {
        let revision = 0, trusted = true, dirty = false;
        const f = fixture({ revision: () => revision, isTrusted: () => trusted, hasUnsavedSketchDocuments: () => dirty });
        f.dependencies.install = async target => {
            if (change === 'source') { revision++; }
            if (change === 'trust') { trusted = false; }
            if (change === 'dirty') { dirty = true; }
            return installed(target);
        };
        const result = await f.handler('install_library', installationInput, new AbortController().signal, () => {}) as LibraryInstallationResult;
        assert.equal(result.status, 'failed');
        assert.equal(result.error?.code, change === 'trust' ? 'WORKSPACE_UNTRUSTED' : change === 'dirty' ? 'UNSAVED_DOCUMENTS' : 'STALE_INPUT');
        assert.equal(result.outcome, 'installed');
        assert.equal(result.changesMayHaveOccurred, true);
        assert.deepEqual(result.changes.added, [{ name: 'Sensor Library', version: '2.0.0' }]);
        assert.deepEqual(result.installedVersions, ['2.0.0']);
        assert.match(result.notes.at(-1)!, /not been rolled back/);
        assert.equal(f.compiles(), 0);
    }
});

test('decoding uses the requested profile without compilation and redacts returned frame details', async () => {
    let decodedLog: string | undefined;
    const f = fixture({ decode: async (target, log) => { decodedLog = log; return decoded(target); } });
    f.target.resolvedProfile = 'debug';
    f.dependencies.inspect = input => { assert.equal(input.profile, 'debug'); return f.target; };
    const result = await f.handler('decode_esp32_backtrace', { sketchPath: '/sketch', profile: 'debug', log: 'PC: 0x40001234' }, new AbortController().signal, () => {}) as BacktraceDecodeResult;
    assert.equal(decodedLog, 'PC: 0x40001234');
    assert.equal(result.target.profile, 'debug');
    assert.equal(result.frames[0].functionName, '<redacted>');
    assert.equal(result.stdout, '<redacted>');
    assert.equal(f.compiles(), 0);
});

test('decoding shares the window operation lock and releases it after cancellation or failure', async () => {
    let finish!: () => void;
    const controller = new AbortController();
    const f = fixture({ decode: async (target) => {
        await new Promise<void>(resolve => { finish = resolve; });
        return decoded(target);
    } });
    const input = { sketchPath: '/sketch', log: 'PC: 0x40001234' };
    const pending = f.handler('decode_esp32_backtrace', input, controller.signal, () => {});
    await assert.rejects(call(f), code('BUSY'));
    await assert.rejects(call(f, 'list_dependencies'), code('BUSY'));
    await assert.rejects(f.handler('decode_esp32_backtrace', input, new AbortController().signal, () => {}), code('BUSY'));
    controller.abort(); finish();
    await assert.rejects(pending, code('CANCELED'));
    f.dependencies.decode = async () => { throw new AiBridgeError('BUILD_REQUIRED', 'A matching build is required.'); };
    await assert.rejects(f.handler('decode_esp32_backtrace', input, new AbortController().signal, () => {}), code('BUILD_REQUIRED'));
    assert.equal((await call(f) as AiOperationResult).status, 'success');
});

test('decoding rejects trust, readiness, dirty files and invalid context before tool execution', async () => {
    for (const [overrides, expected] of [
        [{ isTrusted: () => false }, 'WORKSPACE_UNTRUSTED'],
        [{ isReady: () => false }, 'CLI_NOT_READY'],
        [{ hasUnsavedSketchDocuments: () => true }, 'UNSAVED_DOCUMENTS'],
    ] as [Partial<AiOperationDependencies>, string][]) {
        const f = fixture({ ...overrides, decode: async () => assert.fail('Decoder must not execute.') });
        await assert.rejects(f.handler('decode_esp32_backtrace', { sketchPath: '/sketch', log: 'PC: 0x40001234' }, new AbortController().signal, () => {}), code(expected));
    }
    const invalid = fixture(); invalid.target.canCompile = false;
    await assert.rejects(invalid.handler('decode_esp32_backtrace', { sketchPath: '/sketch', log: 'PC: 0x40001234' }, new AbortController().signal, () => {}), code('INVALID_TARGET'));
});

test('decoding withholds frames when source, target, toolchain, trust or saved documents change', async () => {
    for (const change of ['source', 'profile', 'toolchain', 'trust', 'dirty']) {
        let revision = 0, trusted = true, dirty = false, version = 'initial';
        const f = fixture({ revision: () => revision, isTrusted: () => trusted, hasUnsavedSketchDocuments: () => dirty,
            cliInfo: () => ({ executable: '/tools/cli', version }) });
        f.dependencies.inspect = () => ({ ...f.target });
        f.dependencies.decode = async target => {
            if (change === 'source') { revision++; }
            if (change === 'profile') { f.target.fingerprint = 'changed'; }
            if (change === 'toolchain') { version = 'changed'; }
            if (change === 'trust') { trusted = false; }
            if (change === 'dirty') { dirty = true; }
            return decoded(target);
        };
        await assert.rejects(f.handler('decode_esp32_backtrace', { sketchPath: '/sketch', log: 'PC: 0x40001234' }, new AbortController().signal, () => {}),
            code(change === 'trust' ? 'WORKSPACE_UNTRUSTED' : change === 'dirty' ? 'UNSAVED_DOCUMENTS' : 'STALE_INPUT'));
        assert.equal(f.invalidated(), 0, 'a read-only decoding request must not rewrite build results');
    }
});

test('credential redaction handles quoted flags, nested fields and known values', () => {
    const flags = ['--upload-field', 'password=one', 'build.extra_flags=-DAPI_KEY="two words"', '--auth=three'];
    const values = collectSensitiveValues(flags);
    assert.deepEqual(values, ['two words', 'three', 'one']);
    assert.equal(redactText('one two words three', values), '<redacted> <redacted> <redacted>');
    assert.deepEqual(redactForAssistant({ nested: { access_token: 'hidden', flags } }, values), {
        nested: { access_token: '<redacted>', flags: ['--upload-field', 'password=<redacted>', 'build.extra_flags=-DAPI_KEY="<redacted>"', '--auth=<redacted>'] },
    });
});

test('generic token URL redaction preserves surrounding JSON delimiters and escapes', () => {
    const encoded = JSON.stringify({ url: 'https://example.invalid/?token=dummy', note: 'safe' });
    const parsed = JSON.parse(redactText(encoded));
    assert.equal(parsed.url, 'https://example.invalid/?token=<redacted>');
    assert.equal(parsed.note, 'safe');
    const escaped = JSON.stringify({ url: 'https://example.invalid/?token=dummy"quoted' });
    assert.doesNotThrow(() => JSON.parse(redactText(escaped)));
});

test('credential scanner handles long near-miss keys and preserves quoted JSON values', () => {
    const nearMiss = 'auth'.repeat(128 * 1024);
    assert.equal(redactText(nearMiss), nearMiss);
    assert.equal(redactText(nearMiss + '!'), nearMiss + '!');
    assert.deepEqual(JSON.parse(redactText('{"password":"hidden","api_key":"also hidden","safe":1}')), {
        password: '<redacted>', api_key: '<redacted>', safe: 1,
    });
    assert.equal(redactText('abc', ['a', 'b', 'c']), '<redacted><redacted><redacted>');
    assert.match(redactText('private', Array.from({ length: 33 }, (_, index) => `secret${index}`)), /Output omitted/);
});
