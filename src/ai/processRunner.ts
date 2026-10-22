import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { redactText } from './redaction';

export interface ProcessOptions {
    cwd?: string;
    signal?: AbortSignal;
    /** Maximum retained UTF-8 bytes per stream (and for the combined transcript). */
    maxOutputBytes?: number;
    sensitiveValues?: readonly string[];
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
}

export interface ProcessResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    output: string;
    truncated: boolean;
    canceled: boolean;
    durationMs: number;
    error?: { code: string; message: string };
}

const DEFAULT_OUTPUT_BYTES = 256 * 1024;
const MIN_PENDING_LINE_BYTES = 8 * 1024;
const MAX_PENDING_LINE_BYTES = 8 * 1024 * 1024;
const OMITTED_LINE = '[Arduino output line omitted: exceeds bounded line limit]\n';

class BoundedText {
    private bytes: Buffer = Buffer.alloc(0);
    private start = 0;
    private length = 0;
    public truncated = false;

    public constructor(private readonly limit: number) {}

    public append(text: string): void {
        const incoming = Buffer.from(text, 'utf8');
        if (!incoming.length) { return; }
        if (this.length + incoming.length > this.limit) { this.truncated = true; }

        // A byte ring avoids repeatedly encoding/copying all retained lines. CLI
        // inventories can contain hundreds of thousands of short JSON lines.
        if (incoming.length >= this.limit) {
            this.reserve(this.limit);
            incoming.copy(this.bytes, 0, incoming.length - this.limit);
            this.start = 0;
            this.length = this.limit;
            return;
        }

        this.reserve(Math.min(this.limit, this.length + incoming.length));
        const discarded = Math.max(0, this.length + incoming.length - this.limit);
        this.start = (this.start + discarded) % this.bytes.length;
        this.length -= discarded;
        const end = (this.start + this.length) % this.bytes.length;
        const firstLength = Math.min(incoming.length, this.bytes.length - end);
        incoming.copy(this.bytes, end, 0, firstLength);
        incoming.copy(this.bytes, 0, firstLength);
        this.length += incoming.length;
    }

    private reserve(required: number): void {
        if (required <= this.bytes.length) { return; }
        const replacement = Buffer.allocUnsafe(Math.min(this.limit, Math.max(required, this.bytes.length * 2, 1024)));
        const firstLength = Math.min(this.length, this.bytes.length - this.start);
        this.bytes.copy(replacement, 0, this.start, this.start + firstLength);
        this.bytes.copy(replacement, firstLength, 0, this.length - firstLength);
        this.bytes = replacement;
        this.start = 0;
    }

    public text(): string {
        if (!this.length) { return ''; }
        const end = this.start + this.length;
        const retained = end <= this.bytes.length
            ? this.bytes.subarray(this.start, end)
            : Buffer.concat([this.bytes.subarray(this.start), this.bytes.subarray(0, end - this.bytes.length)], this.length);
        // Keep a valid UTF-8 tail when the byte budget splits its first character.
        let start = 0;
        while (start < retained.length && (retained[start] & 0xc0) === 0x80) {
            start++;
        }
        return retained.subarray(start).toString('utf8');
    }
}

export function redactProcessText(text: string, sensitiveValues: readonly string[] = []): string {
    return redactText(text, sensitiveValues);
}

/**
 * Redact complete lines, so a credential key and its value can arrive in separate
 * OS chunks without leaking through callbacks. Never emit an unfinished prefix:
 * once a line exceeds the pending limit, discard it through its next newline.
 */
class RedactedStream {
    private readonly decoder = new StringDecoder('utf8');
    private pending = '';
    private pendingBytes = 0;
    private discardingLine = false;

    public constructor(
        private readonly secrets: readonly string[],
        private readonly emit: (text: string) => void,
        private readonly onTruncated: () => void,
        private readonly pendingLineLimit: number
    ) {}

    public write(chunk: Buffer): void {
        this.consume(this.decoder.write(chunk));
    }

    public end(): void {
        this.consume(this.decoder.end());
        if (!this.discardingLine && this.pending) {
            this.emit(redactProcessText(this.pending, this.secrets));
        }
        this.pending = '';
        this.pendingBytes = 0;
    }

    private consume(text: string): void {
        let start = 0;
        while (start < text.length) {
            const newline = text.indexOf('\n', start);
            const end = newline === -1 ? text.length : newline;
            const piece = text.slice(start, end);
            if (!this.discardingLine) {
                const bytes = Buffer.byteLength(piece, 'utf8');
                if (this.pendingBytes + bytes > this.pendingLineLimit) {
                    this.pending = '';
                    this.pendingBytes = 0;
                    this.discardingLine = true;
                    this.onTruncated();
                    this.emit(OMITTED_LINE);
                } else {
                    this.pending += piece;
                    this.pendingBytes += bytes;
                }
            }
            if (newline === -1) { return; }
            if (!this.discardingLine) {
                this.emit(redactProcessText(this.pending + '\n', this.secrets));
            }
            this.pending = '';
            this.pendingBytes = 0;
            this.discardingLine = false;
            start = newline + 1;
        }
    }
}

/**
 * Run an internally selected executable with argv, never a shell. Each invocation
 * owns its process, abort listener, output buffers, and process-tree teardown.
 * Expected process failures are returned; the promise settles after stdio closes.
 */
export function runProcess(executable: string, args: readonly string[], options: ProcessOptions = {}): Promise<ProcessResult> {
    const startedAt = Date.now();
    const requestedLimit = options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES;
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : DEFAULT_OUTPUT_BYTES;
    const pendingLineLimit = Math.min(MAX_PENDING_LINE_BYTES, Math.max(MIN_PENDING_LINE_BYTES, limit));
    const stdout = new BoundedText(limit);
    const stderr = new BoundedText(limit);
    const output = new BoundedText(limit);
    let canceled = options.signal?.aborted ?? false;
    let processError: ProcessResult['error'];
    let lineTruncated = false;

    const result = (exitCode: number | null, signal: NodeJS.Signals | null): ProcessResult => ({
        exitCode, signal, stdout: stdout.text(), stderr: stderr.text(), output: output.text(),
        truncated: lineTruncated || stdout.truncated || stderr.truncated || output.truncated,
        canceled, durationMs: Date.now() - startedAt,
        ...(processError ? { error: { ...processError, message: redactProcessText(processError.message, options.sensitiveValues) } } : {})
    });
    if (canceled) { return Promise.resolve(result(null, null)); }

    return new Promise((resolve) => {
        let child: ChildProcess;
        let killTimer: NodeJS.Timeout | undefined;
        let closed = false;
        const abort = () => {
            if (closed || canceled) { return; }
            canceled = true;
            const pid = child.pid;
            if (!pid || !Number.isSafeInteger(pid) || pid <= 0) { return; }
            if (process.platform === 'win32') {
                // A fixed system tool plus a numeric PID; no command string or model input.
                const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
                const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
                killer.on('error', () => { if (!closed) { child.kill(); } });
                killer.on('close', (code) => { if (code !== 0 && !closed) { child.kill(); } });
            } else {
                try { process.kill(-pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
                killTimer = setTimeout(() => {
                    try { process.kill(-pid, 'SIGKILL'); } catch { if (!closed) { child.kill('SIGKILL'); } }
                }, 1500);
                killTimer.unref();
            }
        };

        const emit = (buffer: BoundedText, callback: ((text: string) => void) | undefined) => (text: string) => {
            buffer.append(text);
            output.append(text);
            try { callback?.(text); } catch (error) {
                processError ??= { code: 'OUTPUT_HANDLER_FAILED', message: error instanceof Error ? error.message : String(error) };
                abort();
            }
        };
        const secrets = [...new Set(options.sensitiveValues?.filter(Boolean) ?? [])].sort((left, right) => right.length - left.length);
        const onTruncated = () => { lineTruncated = true; };
        const outStream = new RedactedStream(secrets, emit(stdout, options.onStdout), onTruncated, pendingLineLimit);
        const errStream = new RedactedStream(secrets, emit(stderr, options.onStderr), onTruncated, pendingLineLimit);
        try {
            child = spawn(executable, [...args], {
                cwd: options.cwd, windowsHide: true, shell: false,
                detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (error) {
            processError = { code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) };
            resolve(result(null, null));
            return;
        }
        child.stdout?.on('data', (chunk: Buffer) => outStream.write(chunk));
        child.stderr?.on('data', (chunk: Buffer) => errStream.write(chunk));
        child.on('error', (error: NodeJS.ErrnoException) => {
            processError = { code: error.code || 'SPAWN_FAILED', message: error.message };
        });
        child.on('close', (code, signal) => {
            closed = true;
            options.signal?.removeEventListener('abort', abort);
            if (killTimer) { clearTimeout(killTimer); }
            outStream.end();
            errStream.end();
            // Node reports a negative errno as close code for a failed spawn on Windows.
            resolve(result(child.pid ? code : null, signal));
        });
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) { abort(); }
    });
}
