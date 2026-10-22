import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmAiCompilation, requiresAiCompileConfirmation } from '../compileApproval';
import { AiBridgeError, AiOperationResult, ProjectInspection } from '../contracts';
import { createAiOperationHandler } from '../operations';

const config = (globalValue?: unknown, workspaceValue?: unknown) => ({
    inspect: (section: string) => {
        assert.equal(section, 'ai.confirmCompile');
        return { globalValue, workspaceValue };
    },
});

test('compile confirmation defaults on and only explicit user false opts out', () => {
    for (const value of [undefined, true, null, 0, 'false']) {
        assert.equal(requiresAiCompileConfirmation(config(value, false)), true);
    }
    assert.equal(requiresAiCompileConfirmation(config(false, true)), false);
    assert.equal(requiresAiCompileConfirmation({ inspect: () => undefined }), true);
});

test('default confirmation prompts, trusted user opt-out skips it, and untrusted requests are denied', async () => {
    let prompts = 0;
    const prompt = async () => { prompts++; return true; };
    assert.equal(await confirmAiCompilation(config(), true, prompt), true);
    assert.equal(prompts, 1);
    assert.equal(await confirmAiCompilation(config(false), true, prompt), true);
    assert.equal(prompts, 1);
    assert.equal(await confirmAiCompilation(config(false), false, prompt), false);
    assert.equal(await confirmAiCompilation(config(), false, prompt), false);
    assert.equal(prompts, 1);
    assert.equal(await confirmAiCompilation(config(true), true, async () => false), false);
});

test('turning confirmation back on restores the compile dialog', async () => {
    let globalValue: unknown = false;
    const setting = { inspect: () => ({ globalValue }) };
    let prompts = 0;
    const prompt = async () => { prompts++; return true; };
    await confirmAiCompilation(setting, true, prompt);
    globalValue = true;
    await confirmAiCompilation(setting, true, prompt);
    globalValue = undefined;
    await confirmAiCompilation(setting, true, prompt);
    assert.equal(prompts, 2);
});

test('auto-approved compiles still enforce cancellation, trust, and target freshness before execution', async () => {
    for (const change of ['none', 'cancel', 'trust', 'target'] as const) {
        let trusted = true;
        let fingerprint = 'initial';
        let compiles = 0;
        const abort = new AbortController();
        const target = (): ProjectInspection => ({
            schemaVersion: 1, sketchPath: '/sketch', sketchName: 'sketch', configurationPath: '/sketch/.vscode/arduino.json',
            fqbn: 'arduino:avr:uno', buildPath: '/sketch/build', buildProperties: [], compileArgs: ['compile'], fingerprint, canCompile: true, issues: [],
        });
        const handler = createAiOperationHandler({
            isTrusted: () => trusted, activeSketchPath: () => '/sketch', isReady: () => true,
            inspect: target, cliInfo: () => ({ executable: 'arduino-cli', version: 'test' }),
            hasUnsavedSketchDocuments: () => false, revision: () => 0,
            confirmCompile: () => confirmAiCompilation(config(false), trusted, async () => { throw new Error('Must not prompt'); }),
            compile: async () => {
                compiles++;
                return { schemaVersion: 1, operationId: 'test', status: 'success', target: target(), exitCode: 0, stdout: '', stderr: '', truncated: false, durationMs: 1 };
            },
            discover: async () => [], invalidateBuild: () => {},
        });
        const compiling = handler('compile_sketch', { sketchPath: '/sketch' }, abort.signal, () => {});
        if (change === 'cancel') { abort.abort(); }
        if (change === 'trust') { trusted = false; }
        if (change === 'target') { fingerprint = 'changed'; }
        if (change === 'none') {
            assert.equal((await compiling as AiOperationResult).status, 'success');
            assert.equal(compiles, 1);
        } else {
            const expected = { cancel: 'CANCELED', trust: 'WORKSPACE_UNTRUSTED', target: 'STALE_TARGET' }[change];
            await assert.rejects(compiling, error => error instanceof AiBridgeError && error.code === expected);
            assert.equal(compiles, 0);
        }
    }
});
