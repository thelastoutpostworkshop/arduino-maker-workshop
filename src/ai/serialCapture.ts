import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { type OperationProgress, type SerialCaptureRequest } from './contracts';
import { redactText } from './redaction';
import { validateSerialCapture } from './toolInputs';

export type SerialCaptureStopReason = 'duration' | 'output_limit' | 'canceled' | 'process_exit' | 'context_changed';

export interface SerialCaptureResult {
    schemaVersion: 1;
    request: SerialCaptureRequest;
    status: 'success' | 'failed' | 'canceled';
    stopReason: SerialCaptureStopReason;
    output: string;
    stderr: string;
    receivedBytes: number;
    returnedBytes: number;
    truncated: boolean;
    stderrTruncated: boolean;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    error?: { code: string; message: string };
    notes: string[];
}

export interface SerialCaptureOptions {
    executable: string;
    request: SerialCaptureRequest;
    signal: AbortSignal;
    sensitiveValues?: readonly string[];
    assertCurrent: () => void;
    progress?: (value: OperationProgress) => void;
}

interface SerialCaptureDependencies {
    spawn?: (executable: string, args: string[], options: SpawnOptions) => ChildProcess;
}

const STDERR_LIMIT = 8 * 1024;
const CONTEXT_CHECK_MS = 100;

/** Fixed-size prefix storage: serial data is never sent to progress callbacks. */
class CapturedPrefix {
    private readonly bytes: Buffer;
    private length = 0;
    public receivedBytes = 0;

    public constructor(public readonly limit: number) {
        this.bytes = Buffer.alloc(limit);
    }

    public append(chunk: Buffer): void {
        this.receivedBytes = Math.min(Number.MAX_SAFE_INTEGER, this.receivedBytes + chunk.length);
        const length = Math.min(chunk.length, this.limit - this.length);
        chunk.copy(this.bytes, this.length, 0, length);
        this.length += length;
    }

    public text(discardIncompleteLine: boolean): { text: string; omittedLine: boolean } {
        let length = this.length;
        if (discardIncompleteLine && length && this.bytes[length - 1] !== 10) {
            length = this.bytes.subarray(0, length).lastIndexOf(10) + 1;
        }
        // A partial final UTF-8 character cannot leak into the result as a broken
        // byte prefix. Invalid complete input is decoded as ordinary UTF-8 text.
        const decoder = new StringDecoder('utf8');
        const text = decoder.write(this.bytes.subarray(0, length));
        return { text, omittedLine: length !== this.length };
    }
}

function boundedRedaction(text: string, limit: number, secrets: readonly string[]): { text: string; truncated: boolean } {
    const redacted = redactText(text, secrets);
    const bytes = Buffer.from(redacted, 'utf8');
    if (bytes.length <= limit) { return { text: redacted, truncated: false }; }
    return { text: new StringDecoder('utf8').write(bytes.subarray(0, limit)), truncated: true };
}

/**
 * Read one bounded serial transcript. CLI monitor ends on stdin EOF, so its pipe
 * stays open without ever receiving bytes. Every return waits for process close.
 * The quiet CLI has no readiness event: the deadline includes startup and no
 * result claims that silent firmware was successfully connected.
 */
export async function captureSerialOutput(
    options: SerialCaptureOptions,
    dependencies: SerialCaptureDependencies = {}
): Promise<SerialCaptureResult> {
    const request = validateSerialCapture(options.request.port, options.request.baudRate, options.request.durationMs, options.request.maxOutputBytes);
    const startedAt = Date.now();
    const stdout = new CapturedPrefix(request.maxOutputBytes);
    const stderr = new CapturedPrefix(STDERR_LIMIT);
    const secrets = options.sensitiveValues ?? [];
    let stopReason: SerialCaptureStopReason | undefined;
    let error: SerialCaptureResult['error'];
    let outputLimited = false;
    let stderrLimited = false;

    const result = (exitCode: number | null, signal: NodeJS.Signals | null): SerialCaptureResult => {
        const completedAt = Date.now();
        const reason = stopReason ?? 'process_exit';
        // A bounded stop can split a credential across OS chunks. Discard its
        // unfinished final line before applying the common credential redactor.
        const boundedStop = reason !== 'process_exit';
        const rawOutput = stdout.text(boundedStop || outputLimited);
        const rawError = stderr.text(boundedStop || stderrLimited);
        const output = boundedRedaction(rawOutput.text, request.maxOutputBytes, secrets);
        const diagnostic = boundedRedaction(rawError.text, STDERR_LIMIT, secrets);
        const notes = [
            'Capture timing includes Arduino CLI startup and shutdown; the CLI does not report when the port becomes ready.',
            'Opening a serial port may reset the board. No serial commands were sent, and this capture does not verify which firmware is running.'
        ];
        if (!stdout.receivedBytes) { notes.push('No serial data was received. A silent capture does not confirm that the port opened successfully.'); }
        if (rawOutput.omittedLine || rawError.omittedLine) { notes.push('An unfinished final line was omitted to avoid returning a partial credential.'); }
        return {
            schemaVersion: 1, request, status: reason === 'canceled' ? 'canceled' : error || reason === 'context_changed' || reason === 'process_exit' ? 'failed' : 'success',
            stopReason: reason, output: output.text, stderr: diagnostic.text,
            receivedBytes: stdout.receivedBytes, returnedBytes: Buffer.byteLength(output.text, 'utf8'),
            truncated: outputLimited || rawOutput.omittedLine || output.truncated,
            stderrTruncated: stderrLimited || rawError.omittedLine || diagnostic.truncated,
            startedAt: new Date(startedAt).toISOString(), completedAt: new Date(completedAt).toISOString(),
            durationMs: completedAt - startedAt, exitCode, signal,
            ...(error ? { error: { code: error.code, message: redactText(error.message, secrets) } } : {}), notes
        };
    };

    if (options.signal.aborted) {
        stopReason = 'canceled';
        return result(null, null);
    }
    try {
        options.assertCurrent();
        options.progress?.({ message: `Capturing serial output from ${request.port} at ${request.baudRate} baud.` });
    } catch (failure) {
        stopReason = 'context_changed';
        error = {
            code: failure instanceof Error && 'code' in failure ? String(failure.code) : 'CONTEXT_CHANGED',
            message: failure instanceof Error ? failure.message : String(failure)
        };
        return result(null, null);
    }
    if (options.signal.aborted) {
        stopReason = 'canceled';
        return result(null, null);
    }

    return new Promise((resolve) => {
        let child: ChildProcess;
        let captureCwd: string | undefined;
        let closed = false;
        let deadline: NodeJS.Timeout | undefined;
        let contextTimer: NodeJS.Timeout | undefined;
        let killTimer: NodeJS.Timeout | undefined;
        let treeKillCompleted: Promise<void> | undefined;
        const cleanup = () => {
            options.signal.removeEventListener('abort', onAbort);
            if (deadline) { clearTimeout(deadline); }
            if (contextTimer) { clearInterval(contextTimer); }
            if (killTimer) { clearTimeout(killTimer); }
        };
        const removeWorkingDirectory = () => {
            // Only remove the empty directory created for this invocation. Never
            // recursively delete an externally selected directory or its files.
            if (captureCwd) { try { rmdirSync(captureCwd); } catch { /* Preserve anything unexpectedly created there. */ } }
        };
        const stop = (reason: SerialCaptureStopReason) => {
            if (closed || stopReason) { return; }
            stopReason = reason;
            const pid = child.pid;
            if (!pid || !Number.isSafeInteger(pid) || pid <= 0) { return; }
            // Keep stdin open until teardown. Closing it first can let the CLI
            // parent exit before Windows taskkill has located monitor children.
            if (process.platform === 'win32') {
                const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
                treeKillCompleted = new Promise<void>(resolveKill => {
                    const fallback = () => {
                        error ??= { code: 'SERIAL_CLEANUP_FAILED', message: 'Could not confirm serial monitor process-tree termination.' };
                        if (!closed) { child.kill(); }
                    };
                    try {
                        const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
                        killer.on('error', () => { fallback(); resolveKill(); });
                        killer.on('close', code => { if (code !== 0) { fallback(); } resolveKill(); });
                    } catch {
                        fallback();
                        resolveKill();
                    }
                });
            } else {
                try { process.kill(-pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
                killTimer = setTimeout(() => {
                    try { process.kill(-pid, 'SIGKILL'); } catch { if (!closed) { child.kill('SIGKILL'); } }
                }, 1500);
                killTimer.unref();
            }
        };
        const onAbort = () => stop('canceled');
        const checkContext = () => {
            if (closed || stopReason) { return; }
            try { options.assertCurrent(); } catch (failure) {
                error = {
                    code: failure instanceof Error && 'code' in failure ? String(failure.code) : 'CONTEXT_CHANGED',
                    message: failure instanceof Error ? failure.message : String(failure)
                };
                stop('context_changed');
            }
        };

        try {
            captureCwd = mkdtempSync(path.join(tmpdir(), 'amw-serial-capture-'));
            child = (dependencies.spawn ?? spawn)(options.executable, [
                'monitor', '--port', request.port, '--protocol', 'serial',
                '--config', `baudrate=${request.baudRate},bits=8,parity=none,stop_bits=1`, '--quiet', '--no-color'
            ], {
                // Do not inherit sketch.yaml defaults or initialize its profile.
                cwd: captureCwd, windowsHide: true, shell: false,
                detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (failure) {
            error = { code: 'SPAWN_FAILED', message: failure instanceof Error ? failure.message : String(failure) };
            cleanup();
            removeWorkingDirectory();
            resolve(result(null, null));
            return;
        }
        child.stdin?.on('error', () => { /* Closing the child also closes its unused input pipe. */ });
        child.stdout?.on('data', (chunk: Buffer) => {
            if (stopReason) { return; }
            stdout.append(chunk);
            if (stdout.receivedBytes >= request.maxOutputBytes) {
                outputLimited = true;
                stop('output_limit');
            }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            if (stopReason) { return; }
            stderr.append(chunk);
            if (stderr.receivedBytes >= STDERR_LIMIT) {
                stderrLimited = true;
                if (!stopReason) {
                    error = { code: 'SERIAL_DIAGNOSTIC_LIMIT', message: 'Serial monitor diagnostics exceeded the bounded output limit.' };
                    stop('output_limit');
                }
            }
        });
        child.on('error', (failure: NodeJS.ErrnoException) => {
            error ??= { code: failure.code || 'SPAWN_FAILED', message: failure.message };
        });
        child.on('close', async (code, signal) => {
            closed = true;
            // A parent can terminate before a descendant that ignores SIGTERM.
            // Close the owned process group even when inherited pipes were not
            // retained by that descendant, then release the fallback timer.
            if (stopReason && process.platform !== 'win32' && child.pid) {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The group has already exited. */ }
            }
            cleanup();
            child.stdin?.destroy();
            if (!stopReason) {
                stopReason = 'process_exit';
                error ??= { code: 'SERIAL_MONITOR_EXITED', message: 'Serial monitor exited before the requested capture ended. The port may be unavailable, busy, or disconnected.' };
            }
            await treeKillCompleted;
            removeWorkingDirectory();
            resolve(result(child.pid ? code : null, signal));
        });
        options.signal.addEventListener('abort', onAbort, { once: true });
        contextTimer = setInterval(checkContext, CONTEXT_CHECK_MS);
        contextTimer.unref();
        deadline = setTimeout(() => stop('duration'), Math.max(0, request.durationMs - (Date.now() - startedAt)));
        if (options.signal.aborted) { onAbort(); }
    });
}
