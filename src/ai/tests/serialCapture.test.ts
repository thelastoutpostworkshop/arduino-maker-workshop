import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { AiBridgeError, type SerialCaptureRequest } from '../contracts';
import { captureSerialOutput, type SerialCaptureOptions } from '../serialCapture';

const request: SerialCaptureRequest = { port: 'COM7', baudRate: 115200, durationMs: 1000, maxOutputBytes: 1024 };

function fixture(script: string, overrides: Partial<SerialCaptureOptions> = {}) {
    return captureSerialOutput({
        executable: process.execPath, request, signal: new AbortController().signal, assertCurrent: () => {}, ...overrides
    }, { spawn: (_executable, _args, options) => spawn(process.execPath, ['-e', script], options) });
}

test('serial capture uses fixed literal argv, an empty cwd, and an unwritten open stdin pipe', { timeout: 10000 }, async () => {
    let captureCwd = '';
    const result = await captureSerialOutput({
        executable: process.execPath, request, signal: new AbortController().signal, assertCurrent: () => {}
    }, {
        spawn: (executable, args, options) => {
            assert.equal(executable, process.execPath);
            assert.deepEqual(args, ['monitor', '--port', 'COM7', '--protocol', 'serial', '--config', 'baudrate=115200,bits=8,parity=none,stop_bits=1', '--quiet', '--no-color']);
            assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
            assert.equal(options.shell, false);
            assert.equal(options.windowsHide, true);
            assert.equal(options.detached, process.platform !== 'win32');
            captureCwd = String(options.cwd);
            assert.deepEqual(readdirSync(captureCwd), []);
            return spawn(process.execPath, ['-e', 'process.stdin.on("data",()=>process.exit(21)); process.stdin.on("end",()=>process.exit(22)); process.stdin.resume(); process.stdout.write("sensor=42\\n");'], options);
        }
    });
    assert.equal(result.status, 'success');
    assert.equal(result.stopReason, 'duration');
    assert.equal(result.output, 'sensor=42\n');
    assert.equal(result.receivedBytes, 10);
    assert.equal(result.returnedBytes, 10);
    assert.equal(result.truncated, false);
    assert.ok(result.durationMs >= request.durationMs);
    assert.ok(Date.parse(result.completedAt) >= Date.parse(result.startedAt));
    assert.equal(existsSync(captureCwd), false, 'owned empty cwd is removed after the process closes');
});

test('serial capture stops at its first byte budget and omits a partial final line', async () => {
    const result = await fixture('process.stdout.write("safe line\\n"+"x".repeat(5000)); setInterval(()=>{},1000);');
    assert.equal(result.status, 'success');
    assert.equal(result.stopReason, 'output_limit');
    assert.equal(result.output, 'safe line\n');
    assert.ok(result.receivedBytes >= request.maxOutputBytes);
    assert.equal(result.returnedBytes, 10);
    assert.equal(result.truncated, true);
    assert.match(result.notes.join(' '), /unfinished final line/i);
});

test('serial capture preserves a complete line ending exactly on the byte limit', async () => {
    const result = await fixture('process.stdout.write("x".repeat(1023)+"\\n"); setInterval(()=>{},1000);');
    assert.equal(result.stopReason, 'output_limit');
    assert.equal(result.returnedBytes, 1024);
    assert.equal(result.output, 'x'.repeat(1023) + '\n');
    assert.equal(result.truncated, true);
});

test('serial capture redacts split credentials once and retains valid UTF-8', async () => {
    const result = await fixture('process.stdout.write("temperature=\\u00e9\\nknown super-"); setTimeout(()=>{process.stdout.write("secret\\npassword=");setTimeout(()=>process.stdout.write("private-value\\n"),20)},20); setInterval(()=>{},1000);', {
        sensitiveValues: ['super-secret']
    });
    assert.equal(result.status, 'success');
    assert.equal(result.output, 'temperature=\u00e9\nknown <redacted>\npassword=<redacted>\n');
    assert.ok(!result.output.includes('\ufffd'));
    assert.ok(!JSON.stringify(result).includes('super-secret'));
    assert.ok(!JSON.stringify(result).includes('private-value'));
});

test('serial capture keeps the final redacted result within the byte budget when redaction expands it', async () => {
    const result = await fixture('process.stdout.write("token=x\\n".repeat(128)); setInterval(()=>{},1000);');
    assert.equal(result.stopReason, 'output_limit');
    assert.ok(result.output.startsWith('token=<redacted>\n'));
    assert.ok(result.returnedBytes <= request.maxOutputBytes);
    assert.equal(result.truncated, true);
});

test('serial capture treats early nonzero exit as failure and preserves separate diagnostics', async () => {
    const result = await fixture('process.stdout.write("one reading\\n");process.stderr.write("port unavailable password=private-value");process.exitCode=4;');
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'process_exit');
    assert.equal(result.exitCode, 4);
    assert.equal(result.output, 'one reading\n');
    assert.equal(result.stderr, 'port unavailable password=<redacted>');
    assert.equal(result.error?.code, 'SERIAL_MONITOR_EXITED');
});

test('serial capture treats an early clean exit as an interruption such as device removal', async () => {
    const result = await fixture('process.stdout.write("last reading\\n");');
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'process_exit');
    assert.equal(result.exitCode, 0);
    assert.match(result.error?.message ?? '', /disconnected/i);
    assert.equal(result.output, 'last reading\n');
});

test('serial capture reports missing executables and cleans the temporary working directory', async () => {
    let captureCwd = '';
    const result = await captureSerialOutput({
        executable: path.join(tmpdir(), 'missing-amw-serial-capture-executable'), request,
        signal: new AbortController().signal, assertCurrent: () => {}
    }, { spawn: (executable, args, options) => { captureCwd = String(options.cwd); return spawn(executable, args, options); } });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'process_exit');
    assert.equal(result.exitCode, null);
    assert.equal(result.error?.code, 'ENOENT');
    assert.equal(existsSync(captureCwd), false);
});

test('serial capture handles synchronous process launch failure with cleanup', async () => {
    let captureCwd = '';
    const result = await captureSerialOutput({
        executable: process.execPath, request, signal: new AbortController().signal, assertCurrent: () => {}
    }, { spawn: (_executable, _args, options) => { captureCwd = String(options.cwd); throw new Error('fixture spawn failure'); } });
    assert.equal(result.error?.code, 'SPAWN_FAILED');
    assert.equal(result.status, 'failed');
    assert.equal(existsSync(captureCwd), false);
});

test('already canceled serial capture never starts a process or calls its context guard', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await captureSerialOutput({
        executable: process.execPath, request, signal: controller.signal,
        assertCurrent: () => { assert.fail('must not inspect after cancellation'); }
    }, { spawn: () => { throw new Error('must not spawn'); } });
    assert.equal(result.status, 'canceled');
    assert.equal(result.stopReason, 'canceled');
    assert.equal(result.exitCode, null);
    assert.equal(result.receivedBytes, 0);
});

test('serial capture checks context before starting and while a silent child is running', async () => {
    let checks = 0;
    const result = await fixture('setInterval(()=>{},1000);', {
        assertCurrent: () => {
            if (++checks > 1) { throw new AiBridgeError('WORKSPACE_CHANGED', 'The selected workspace changed.'); }
        }
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'context_changed');
    assert.equal(result.error?.code, 'WORKSPACE_CHANGED');
    const checksAtClose = checks;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(checks, checksAtClose, 'context polling stops after cleanup');
});

test('serial capture refuses invalid context before launch', async () => {
    const result = await captureSerialOutput({
        executable: process.execPath, request, signal: new AbortController().signal,
        assertCurrent: () => { throw new AiBridgeError('WORKSPACE_UNTRUSTED', 'Workspace is not trusted.'); }
    }, { spawn: () => { throw new Error('must not spawn'); } });
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'context_changed');
    assert.equal(result.error?.code, 'WORKSPACE_UNTRUSTED');
});

test('serial capture cancellation closes its entire process tree and does not leave pipe handles open', { timeout: 10000 }, async () => {
    const controller = new AbortController();
    const directory = mkdtempSync(path.join(tmpdir(), 'amw-serial-test-'));
    const readyFile = path.join(directory, 'ready');
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(readyFile)},'ready'); process.stdout.write('descendant-ready\\n'); setInterval(()=>{},1000);`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','inherit','inherit']}); setInterval(()=>{},1000);`;
    try {
        const result = await fixture(parent, {
            request: { ...request, durationMs: 5000 }, signal: controller.signal,
            assertCurrent: () => { if (existsSync(readyFile)) { controller.abort(); } }
        });
        assert.equal(result.status, 'canceled');
        assert.equal(result.stopReason, 'canceled');
        assert.equal(result.error, undefined);
        assert.ok(result.durationMs < 9000);
        assert.equal(existsSync(readyFile), true);
    } finally {
        if (existsSync(readyFile)) { unlinkSync(readyFile); }
        rmdirSync(directory);
    }
});

test('serial capture duration also terminates descendants without inherited output pipes', { timeout: 10000 }, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amw-serial-test-'));
    const marker = path.join(directory, 'descendant');
    const descendant = `const fs=require('node:fs'); process.on('SIGTERM',()=>{}); const write=()=>fs.writeFileSync(${JSON.stringify(marker)},String(process.pid)); write();setInterval(write,30);`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
    try {
        const result = await fixture(parent);
        assert.equal(result.status, 'success');
        assert.equal(result.stopReason, 'duration');
        assert.equal(result.error, undefined);
        assert.equal(existsSync(marker), true);
        const modifiedAt = statSync(marker).mtimeMs;
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(statSync(marker).mtimeMs, modifiedAt, 'descendant must stop writing before capture returns');
    } finally {
        if (existsSync(marker)) {
            const pid = Number(readFileSync(marker, 'utf8'));
            if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ } }
            unlinkSync(marker);
        }
        rmdirSync(directory);
    }
});

test('serial capture does not launch if cancellation arrives in its initial progress callback', async () => {
    const controller = new AbortController();
    const result = await captureSerialOutput({
        executable: process.execPath, request, signal: controller.signal, assertCurrent: () => {},
        progress: () => controller.abort()
    }, { spawn: () => { throw new Error('must not spawn'); } });
    assert.equal(result.status, 'canceled');
    assert.equal(result.exitCode, null);
});

test('serial capture bounds stderr independently and stops a noisy failed monitor', async () => {
    const result = await fixture('process.stderr.write(("diagnostic\\n").repeat(2000));setInterval(()=>{},1000);');
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'output_limit');
    assert.equal(result.error?.code, 'SERIAL_DIAGNOSTIC_LIMIT');
    assert.equal(result.stderrTruncated, true);
    assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= 8192);
    assert.equal(result.receivedBytes, 0);
});

test('serial capture reports silent bounded completion without claiming connection readiness', async () => {
    const result = await fixture('setInterval(()=>{},1000);');
    assert.equal(result.status, 'success');
    assert.equal(result.stopReason, 'duration');
    assert.equal(result.output, '');
    assert.equal(result.receivedBytes, 0);
    assert.match(result.notes.join(' '), /does not confirm that the port opened/i);
    assert.match(result.notes.join(' '), /startup and shutdown/i);
});

test('serial capture validates every request before starting a process', async () => {
    await assert.rejects(captureSerialOutput({
        executable: process.execPath, request: { ...request, port: '--inject' },
        signal: new AbortController().signal, assertCurrent: () => {}
    }, { spawn: () => { throw new Error('must not spawn'); } }), { code: 'INVALID_ARGUMENTS' });
});
