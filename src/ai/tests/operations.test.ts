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
        hasUnsavedSketchDocuments: () => false, revision: () => 0, confirmCompile: async () => true,
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

test('discovery returns sanitized structured data and never requests compilation consent', async () => {
    const f = fixture({ confirmCompile: async () => { throw new Error('must not prompt'); } });
    assert.deepEqual(await call(f, 'list_ports'), { boards: [], password: '<redacted>' });
    assert.equal(f.compiles(), 0);
});

test('compile returns structured completion after approval with bounded output redaction', async () => {
    const f = fixture();
    const result = await call(f) as AiOperationResult;
    assert.equal(result.status, 'success');
    assert.equal(result.exitCode, 0);
    assert.equal(f.compiles(), 1);
    assert.ok(!JSON.stringify(result).includes('private password'));
});

test('declined, dirty and invalid targets never execute', async () => {
    const declined = fixture({ confirmCompile: async () => false });
    await assert.rejects(call(declined), code('CANCELED'));
    const dirty = fixture({ hasUnsavedSketchDocuments: () => true });
    await assert.rejects(call(dirty), code('UNSAVED_DOCUMENTS'));
    const invalid = fixture(); invalid.target.canCompile = false;
    await assert.rejects(call(invalid), code('INVALID_TARGET'));
    assert.equal(declined.compiles() + dirty.compiles() + invalid.compiles(), 0);
});

test('target and executable changes while awaiting approval invalidate the request', async () => {
    const changed = fixture();
    changed.dependencies.confirmCompile = async () => { changed.target.fingerprint = 'changed'; return true; };
    // Return immutable inspection snapshots as the real inspector does.
    const original = { ...changed.target };
    let inspections = 0;
    changed.dependencies.inspect = () => ++inspections === 1 ? original : changed.target;
    await assert.rejects(call(changed), code('STALE_TARGET'));
    const executable = fixture();
    let approved = false;
    executable.dependencies.confirmCompile = async () => { approved = true; return true; };
    executable.dependencies.cliInfo = () => ({ executable: approved ? '/other' : '/tools', version: 'test' });
    await assert.rejects(call(executable), code('STALE_TARGET'));
});

test('cancellation and lost trust during approval cannot start compilation', async () => {
    const abort = new AbortController();
    const canceled = fixture({ confirmCompile: async () => { abort.abort(); return true; } });
    await assert.rejects(call(canceled, 'compile_sketch', abort.signal), code('CANCELED'));
    let trusted = true;
    const revoked = fixture({ isTrusted: () => trusted, confirmCompile: async () => { trusted = false; return true; } });
    await assert.rejects(call(revoked), code('WORKSPACE_UNTRUSTED'));
});

test('cancel settles an unresolved approval and a late approval never executes', async () => {
    const abort = new AbortController();
    let approve!: (value: boolean) => void;
    const f = fixture({ confirmCompile: () => new Promise(resolve => { approve = resolve; }) });
    const waiting = call(f, 'compile_sketch', abort.signal);
    abort.abort();
    await assert.rejects(waiting, code('CANCELED'));
    approve(true);
    await Promise.resolve();
    assert.equal(f.compiles(), 0);
    f.dependencies.confirmCompile = async () => true;
    assert.equal((await call(f) as AiOperationResult).status, 'success');
});

test('concurrent compiles are rejected while consent is pending and lock is released', async () => {
    let approve!: (value: boolean) => void;
    const f = fixture({ confirmCompile: () => new Promise(resolve => { approve = resolve; }) });
    const pending = call(f);
    await assert.rejects(call(f), code('BUSY'));
    approve(false);
    await assert.rejects(pending, code('CANCELED'));
    f.dependencies.confirmCompile = async () => true;
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
