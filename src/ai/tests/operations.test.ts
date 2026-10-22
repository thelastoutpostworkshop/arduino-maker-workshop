import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiBridgeError, AiOperationResult, ProjectInspection } from '../contracts';
import { AiOperationDependencies, createAiOperationHandler } from '../operations';
import { collectSensitiveValues, redactForAssistant, redactText } from '../redaction';

function fixture(overrides: Partial<AiOperationDependencies> = {}) {
    const target: ProjectInspection = {
        schemaVersion: 1, sketchPath: '/sketch', sketchName: 'sketch', configurationPath: '/sketch/.vscode/arduino.json',
        fqbn: 'arduino:avr:uno', buildPath: '/sketch/build', buildProperties: ['build.extra_flags=-DWIFI_PASSWORD="private password"'],
        compileArgs: ['compile', '--build-property', 'build.extra_flags=-DWIFI_PASSWORD="private password"'], fingerprint: 'initial', canCompile: true, issues: [],
        availableProfiles: [], declaredDependencies: { platforms: [], libraries: [], issues: [] },
    };
    let compiles = 0;
    let invalidated = 0;
    const result = (): AiOperationResult => ({
        schemaVersion: 1, operationId: 'operation-1', status: 'success', target, exitCode: 0,
        stdout: 'value private password', stderr: '', truncated: false, durationMs: 1,
    });
    const dependencies: AiOperationDependencies = {
        isTrusted: () => true, activeSketchPath: () => '/sketch', isReady: () => true,
        inspect: () => target, cliInfo: () => ({ executable: '/tools/arduino-cli', version: 'test' }),
        hasUnsavedSketchDocuments: () => false, revision: () => 0,
        compile: async () => { compiles++; return result(); },
        discover: async () => ({ boards: [], password: 'hidden' }),
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
