import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { AiBridgeError, AiToolHandler, AiToolName, AiToolInput, OperationProgress } from './contracts';
import { redactText } from './redaction';
import { validateToolCall } from './toolInputs';
export { AI_TOOL_NAMES, validateToolCall } from './toolInputs';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = MAX_RESULT_BYTES + 8192;
const MAX_CONNECTIONS = 8;
const MAX_REQUESTS = 16;

export interface AiSessionDescriptor {
    schemaVersion: 1;
    sessionId: string;
    token: string;
    endpoint: string;
    sketchPath: string;
    workspaceId: string;
}

export interface AiIpcServerOptions {
    sessionDirectory: string;
    sketchPath: string;
    handler: AiToolHandler;
    isTrusted: () => boolean;
}

export interface AiIpcServer {
    sessionFile: string;
    sessionId: string;
    dispose(): Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Bounded newline framing. StringDecoder preserves UTF-8 split across socket chunks. */
export function receiveLines(stream: NodeJS.ReadableStream, maximumBytes: number, line: (value: string) => void, fail: () => void): () => void {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let stopped = false;
    const stop = () => {
        stopped = true;
        stream.removeListener('data', data);
        stream.removeListener('end', end);
    };
    const data = (chunk: Buffer | string) => {
        if (stopped) { return; }
        pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let newline: number;
        while (!stopped && (newline = pending.indexOf('\n')) !== -1) {
            const value = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            if (Buffer.byteLength(value) > maximumBytes) { stop(); fail(); return; }
            if (value.trim()) { line(value); }
        }
        if (Buffer.byteLength(pending) > maximumBytes) { stop(); fail(); }
    };
    const end = () => {
        pending += decoder.end();
        // A truncated frame must not execute when its transport closes.
        stop();
    };
    stream.on('data', data);
    stream.on('end', end);
    return stop;
}

function safeError(error: unknown): { code: string; message: string } {
    if (error instanceof AiBridgeError && /^[A-Z_]{1,64}$/.test(error.code)) {
        return { code: error.code, message: redactText(error.message).slice(0, 2048) };
    }
    return { code: 'INTERNAL_ERROR', message: 'The bridge operation failed. Check Arduino Maker Workshop in VS Code.' };
}

function samePath(left: string, right: string): boolean {
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function writeFrame(socket: net.Socket, value: unknown): boolean {
    if (socket.destroyed) { return false; }
    let serialized: string;
    try { serialized = JSON.stringify(value) + '\n'; } catch { socket.destroy(); return false; }
    if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES || socket.writableLength + Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES * 2) {
        socket.destroy();
        return false;
    }
    socket.write(serialized);
    return true;
}

export async function createAiIpcServer(options: AiIpcServerOptions): Promise<AiIpcServer> {
    const sketchPath = await fs.realpath(options.sketchPath);
    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const workspaceId = crypto.createHash('sha256').update(sketchPath).digest('hex');
    await fs.mkdir(options.sessionDirectory, { recursive: true, mode: 0o700 });
    const directory = await fs.mkdtemp(path.join(options.sessionDirectory, 'session-'));
    const sessionFile = path.join(directory, 'session.json');
    // sockaddr_un paths are short (104 bytes on macOS). Global storage paths often exceed that.
    const socketName = `amw-ai-${sessionId}`;
    const temporaryBase = Buffer.byteLength(path.join(os.tmpdir(), socketName, 'ipc.sock')) <= 100 ? os.tmpdir() : '/tmp';
    const socketDirectory = process.platform === 'win32' ? undefined : path.join(temporaryBase, socketName);
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\arduino-maker-workshop-${sessionId}` : path.join(socketDirectory!, 'ipc.sock');
    const descriptor: AiSessionDescriptor = { schemaVersion: 1, sessionId, token, endpoint, sketchPath, workspaceId };
    const sockets = new Set<net.Socket>();
    let activeRequests = 0;
    let disposed = false;
    let socketDirectoryCreated = false;
    let descriptorWrite: Promise<void> | undefined;
    const server = net.createServer(socket => {
        if (disposed || sockets.size >= MAX_CONNECTIONS) { socket.destroy(); return; }
        sockets.add(socket);
        const requests = new Map<string, AbortController>();
        let authenticated = false;
        let closing = false;
        const authTimer = setTimeout(() => socket.destroy(), 5000);
        authTimer.unref();
        socket.on('error', () => { /* Transport errors are returned without logging credentials. */ });
        socket.once('close', () => {
            clearTimeout(authTimer);
            sockets.delete(socket);
            for (const controller of requests.values()) { controller.abort(); }
        });
        const reject = (id: string | undefined, error: unknown) => writeFrame(socket, { type: 'error', id, error: safeError(error) });
        receiveLines(socket, MAX_INPUT_BYTES, raw => {
            if (closing) { return; }
            let frame: unknown;
            try { frame = JSON.parse(raw); } catch { socket.destroy(); return; }
            if (!record(frame)) { socket.destroy(); return; }
            if (!authenticated) {
                const validToken = typeof frame.token === 'string' && /^[a-f0-9]{64}$/.test(frame.token) &&
                    crypto.timingSafeEqual(Buffer.from(frame.token, 'hex'), Buffer.from(token, 'hex'));
                if (frame.type !== 'hello' || !validToken || frame.sessionId !== sessionId || frame.workspaceId !== workspaceId || frame.sketchPath !== sketchPath) {
                    closing = true;
                    reject(undefined, new AiBridgeError('UNAUTHORIZED', 'Session authentication failed.'));
                    socket.end();
                    return;
                }
                authenticated = true;
                clearTimeout(authTimer);
                writeFrame(socket, { type: 'ready', sessionId });
                return;
            }
            if (typeof frame.id !== 'string' || frame.id.length === 0 || frame.id.length > 128) { socket.destroy(); return; }
            const id = frame.id;
            if (frame.type === 'cancel') { requests.get(id)?.abort(); return; }
            if (frame.type !== 'call' || requests.has(id)) { reject(id, new AiBridgeError('INVALID_REQUEST', 'The bridge request is invalid or duplicated.')); return; }
            if (activeRequests >= MAX_REQUESTS) { reject(id, new AiBridgeError('BUSY', 'The bridge is busy. Retry after current operations finish.')); return; }
            const controller = new AbortController();
            requests.set(id, controller);
            activeRequests++;
            void (async () => {
                try {
                    const call = validateToolCall(frame.name, frame.input);
                    const requestedPath = await fs.realpath(call.input.sketchPath).catch(() => '');
                    if (!samePath(requestedPath, sketchPath)) { throw new AiBridgeError('WRONG_WORKSPACE', 'This session is limited to its connected sketch.'); }
                    if (!options.isTrusted()) { throw new AiBridgeError('WORKSPACE_UNTRUSTED', 'Trust the workspace in VS Code before using this session.'); }
                    if (controller.signal.aborted || disposed) { throw new AiBridgeError('CANCELED', 'The operation was canceled.'); }
                    let lastProgress = 0;
                    const result = await options.handler(call.name, { ...call.input, sketchPath }, controller.signal, progress => {
                        if (controller.signal.aborted || socket.destroyed || Date.now() - lastProgress < 100) { return; }
                        lastProgress = Date.now();
                        writeFrame(socket, { type: 'progress', id, progress: { message: String(progress.message).slice(0, 1024) } });
                    });
                    if (controller.signal.aborted) { throw new AiBridgeError('CANCELED', 'The operation was canceled.'); }
                    if (Buffer.byteLength(JSON.stringify(result) ?? 'null') > MAX_RESULT_BYTES) { throw new AiBridgeError('OUTPUT_LIMIT', 'The operation output exceeded the bridge limit.'); }
                    writeFrame(socket, { type: 'result', id, result: result ?? null });
                } catch (error) { reject(id, error); }
                finally { requests.delete(id); activeRequests--; }
            })();
        }, () => socket.destroy());
    });
    let disposal: Promise<void> | undefined;
    const dispose = (): Promise<void> => {
        if (!disposal) {
            disposed = true;
            for (const socket of sockets) { socket.destroy(); }
            disposal = (async () => {
                try { await new Promise<void>(resolve => server.close(() => resolve())); }
                finally {
                    // Publication may be in flight when a runtime transport error arrives.
                    await descriptorWrite?.catch(() => {});
                    await Promise.all([
                        fs.rm(directory, { recursive: true, force: true }),
                        socketDirectoryCreated ? fs.rm(socketDirectory!, { recursive: true, force: true }) : Promise.resolve()
                    ]);
                }
            })();
        }
        return disposal;
    };
    // Keep an error listener for the entire server lifetime. Transport failure revokes
    // the session; neither runtime errors nor cleanup failures escape as uncaught errors.
    server.on('error', () => { void dispose().catch(() => {}); });
    try {
        await fs.chmod(directory, 0o700);
        if (socketDirectory) {
            await fs.mkdir(socketDirectory, { mode: 0o700 });
            socketDirectoryCreated = true;
        }
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(endpoint, () => { server.removeListener('error', reject); resolve(); });
        });
        if (disposed) { throw new AiBridgeError('SESSION_UNAVAILABLE', 'The bridge session could not be started.'); }
        if (process.platform !== 'win32') { await fs.chmod(endpoint, 0o600); }
        if (disposed) { throw new AiBridgeError('SESSION_UNAVAILABLE', 'The bridge session could not be started.'); }
        descriptorWrite = fs.writeFile(sessionFile, JSON.stringify(descriptor), { mode: 0o600, flag: 'wx' });
        await descriptorWrite;
        if (disposed) { throw new AiBridgeError('SESSION_UNAVAILABLE', 'The bridge session could not be started.'); }
    } catch (error) {
        await dispose();
        throw error;
    }
    return { sessionFile, sessionId, dispose };
}

export async function readSessionDescriptor(sessionFile: string): Promise<AiSessionDescriptor> {
    try {
        if (!path.isAbsolute(sessionFile)) { throw new Error(); }
        const stat = await fs.lstat(sessionFile);
        const parent = await fs.lstat(path.dirname(sessionFile));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192 || !parent.isDirectory() || parent.isSymbolicLink()) { throw new Error(); }
        if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || (parent.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || parent.uid !== process.getuid?.())) { throw new Error(); }
        const value: unknown = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
        if (!record(value) || value.schemaVersion !== 1 || typeof value.sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.sessionId) ||
            typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token) || typeof value.sketchPath !== 'string' || !path.isAbsolute(value.sketchPath) ||
            typeof value.workspaceId !== 'string' || value.workspaceId !== crypto.createHash('sha256').update(value.sketchPath).digest('hex')) { throw new Error(); }
        if (typeof value.endpoint !== 'string') { throw new Error(); }
        if (process.platform === 'win32') {
            if (value.endpoint !== `\\\\.\\pipe\\arduino-maker-workshop-${value.sessionId}`) { throw new Error(); }
        } else {
            if (!path.isAbsolute(value.endpoint) || path.resolve(value.endpoint) !== value.endpoint || path.basename(value.endpoint) !== 'ipc.sock' ||
                path.basename(path.dirname(value.endpoint)) !== `amw-ai-${value.sessionId}`) { throw new Error(); }
            const socketParent = await fs.lstat(path.dirname(value.endpoint));
            const socket = await fs.lstat(value.endpoint);
            if (!socketParent.isDirectory() || socketParent.isSymbolicLink() || (socketParent.mode & 0o077) !== 0 || socketParent.uid !== process.getuid?.() ||
                !socket.isSocket() || (socket.mode & 0o077) !== 0 || socket.uid !== process.getuid?.()) { throw new Error(); }
        }
        return value as unknown as AiSessionDescriptor;
    } catch { throw new AiBridgeError('INVALID_SESSION', 'This session is unavailable. Reconnect the local AI bridge in VS Code.'); }
}

interface PendingCall {
    resolve(value: unknown): void;
    reject(error: Error): void;
    progress(value: OperationProgress): void;
    removeAbort(): void;
}

export class AiIpcClient {
    private readonly pending = new Map<string, PendingCall>();
    private constructor(private readonly socket: net.Socket, public readonly sketchPath: string, public readonly sessionId: string) {}

    get connected(): boolean { return !this.socket.destroyed; }

    static async connect(sessionFile: string, signal?: AbortSignal): Promise<AiIpcClient> {
        const canceled = () => new AiBridgeError('CANCELED', 'Connecting to the AI bridge was canceled.');
        if (signal?.aborted) { throw canceled(); }
        const descriptor = await readSessionDescriptor(sessionFile);
        if (signal?.aborted) { throw canceled(); }
        const socket = net.createConnection(descriptor.endpoint);
        const client = new AiIpcClient(socket, descriptor.sketchPath, descriptor.sessionId);
        await new Promise<void>((resolve, reject) => {
            let ready = false;
            const abort = () => { socket.destroy(); reject(canceled()); };
            signal?.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => { socket.destroy(); reject(new AiBridgeError('SESSION_UNAVAILABLE', 'The VS Code bridge session did not respond.')); }, 5000);
            socket.on('error', error => {
                if (!ready) {
                    const unavailable = new AiBridgeError('SESSION_UNAVAILABLE', 'The VS Code bridge session is unavailable.');
                    unavailable.cause = error;
                    reject(unavailable);
                }
            });
            socket.once('close', () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (!ready) { reject(new AiBridgeError('SESSION_UNAVAILABLE', 'The VS Code bridge session is unavailable.')); }
                client.failPending();
            });
            socket.once('connect', () => writeFrame(socket, { type: 'hello', token: descriptor.token, sessionId: descriptor.sessionId, workspaceId: descriptor.workspaceId, sketchPath: descriptor.sketchPath }));
            receiveLines(socket, MAX_RESPONSE_BYTES, raw => {
                let frame: unknown;
                try { frame = JSON.parse(raw); } catch { socket.destroy(); return; }
                if (!record(frame)) { socket.destroy(); return; }
                if (!ready) {
                    if (frame.type !== 'ready' || frame.sessionId !== descriptor.sessionId) { socket.destroy(); return; }
                    ready = true;
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abort);
                    resolve();
                    return;
                }
                if (typeof frame.id !== 'string') { socket.destroy(); return; }
                const pending = client.pending.get(frame.id);
                if (!pending) { return; }
                if (frame.type === 'progress' && record(frame.progress) && typeof frame.progress.message === 'string') { pending.progress({ message: frame.progress.message.slice(0, 1024) }); return; }
                client.pending.delete(frame.id);
                pending.removeAbort();
                if (frame.type === 'result') { pending.resolve(frame.result); }
                else if (frame.type === 'error' && record(frame.error) && typeof frame.error.code === 'string' && typeof frame.error.message === 'string') { pending.reject(new AiBridgeError(frame.error.code, frame.error.message)); }
                else { pending.reject(new AiBridgeError('INVALID_RESPONSE', 'The bridge returned an invalid response.')); socket.destroy(); }
            }, () => socket.destroy());
            if (signal?.aborted) { abort(); }
        }).catch(error => { socket.destroy(); throw error; });
        return client;
    }

    call(name: AiToolName, input: AiToolInput, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<unknown> {
        if (this.socket.destroyed) { return Promise.reject(new AiBridgeError('SESSION_UNAVAILABLE', 'The VS Code bridge session is unavailable.')); }
        if (signal.aborted) { return Promise.reject(new AiBridgeError('CANCELED', 'The operation was canceled.')); }
        if (this.pending.size >= MAX_REQUESTS) { return Promise.reject(new AiBridgeError('BUSY', 'The bridge is busy.')); }
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const abort = () => {
                writeFrame(this.socket, { type: 'cancel', id });
                this.pending.delete(id);
                signal.removeEventListener('abort', abort);
                reject(new AiBridgeError('CANCELED', 'The operation was canceled.'));
            };
            this.pending.set(id, { resolve, reject, progress, removeAbort: () => signal.removeEventListener('abort', abort) });
            signal.addEventListener('abort', abort, { once: true });
            if (!writeFrame(this.socket, { type: 'call', id, name, input })) { this.failPending(); }
        });
    }

    dispose(): void { this.socket.destroy(); this.failPending(); }

    private failPending(): void {
        for (const pending of this.pending.values()) {
            pending.removeAbort();
            pending.reject(new AiBridgeError('SESSION_UNAVAILABLE', 'The VS Code bridge session ended. Reconnect it in VS Code.'));
        }
        this.pending.clear();
    }
}
