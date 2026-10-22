import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AiBridgeError } from './contracts';
import { AiIpcClient, readSessionDescriptor } from './ipcServer';

const MAX_DIRECTORY_ENTRIES = 512;
const MAX_SESSION_DIRECTORIES = 128;
const DISCOVERY_TIMEOUT_MS = 5000;

function samePath(left: string, right: string): boolean {
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function unavailable(message = 'No live AI session is connected for this sketch. Run Connect AI Assistant in its VS Code window and retry.'): AiBridgeError {
    return new AiBridgeError('SESSION_UNAVAILABLE', message);
}

function definitelyStale(error: unknown): boolean {
    const cause = error instanceof Error ? (error as Error & { cause?: NodeJS.ErrnoException }).cause : undefined;
    return cause?.code === 'ENOENT' || cause?.code === 'ECONNREFUSED';
}

/** Stable sketch scope with ephemeral, authenticated connections to explicitly enabled sessions. */
export class AiSessionResolver {
    private current: AiIpcClient | undefined;
    private pending: Promise<AiIpcClient> | undefined;
    private discoveryAbort: AbortController | undefined;
    private disposed = false;

    private constructor(public readonly sketchPath: string, private readonly sessionDirectory: string) {}

    static async create(sketchPath: string, sessionDirectory: string): Promise<AiSessionResolver> {
        if (!path.isAbsolute(sketchPath) || !path.isAbsolute(sessionDirectory)) {
            throw new AiBridgeError('INVALID_ARGUMENTS', 'Absolute sketch and session-directory paths are required.');
        }
        let canonicalSketch: string;
        try {
            canonicalSketch = await fs.realpath(sketchPath);
            if (!(await fs.stat(canonicalSketch)).isDirectory()) { throw new Error(); }
        } catch { throw unavailable('The configured sketch folder is unavailable. Check the sketch path in the MCP configuration.'); }
        return new AiSessionResolver(canonicalSketch, path.resolve(sessionDirectory));
    }

    getClient(): Promise<AiIpcClient> {
        if (this.disposed) { return Promise.reject(unavailable('The AI session resolver is closed.')); }
        if (this.pending) { return this.pending; }
        const controller = new AbortController();
        this.discoveryAbort = controller;
        const timer = setTimeout(() => controller.abort(unavailable('Finding the VS Code AI session timed out. Check its connection and retry.')), DISCOVERY_TIMEOUT_MS);
        timer.unref();
        let removeAbort = () => {};
        const interrupted = new Promise<never>((_resolve, reject) => {
            const abort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
            removeAbort = () => controller.signal.removeEventListener('abort', abort);
        });
        const pending = Promise.race([this.discover(controller.signal), interrupted]).finally(() => {
            clearTimeout(timer);
            removeAbort();
            if (this.pending === pending) { this.pending = undefined; }
            if (this.discoveryAbort === controller) { this.discoveryAbort = undefined; }
        });
        this.pending = pending;
        return pending;
    }

    dispose(): void {
        this.disposed = true;
        this.discoveryAbort?.abort(unavailable('The AI session resolver is closed.'));
        this.current?.dispose();
        this.current = undefined;
    }

    private assertActive(signal: AbortSignal): void {
        if (signal.aborted) { throw signal.reason; }
        if (this.disposed) { throw unavailable('The AI session resolver is closed.'); }
    }

    private async sessionFiles(signal: AbortSignal): Promise<string[]> {
        this.assertActive(signal);
        try {
            const stat = await fs.lstat(this.sessionDirectory);
            if (!stat.isDirectory() || stat.isSymbolicLink() ||
                (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
                throw unavailable('The AI session directory is not a private local directory. Reconnect the bridge in VS Code.');
            }
            const files: string[] = [];
            let entries = 0;
            const directory = await fs.opendir(this.sessionDirectory);
            for await (const entry of directory) {
                this.assertActive(signal);
                if (++entries > MAX_DIRECTORY_ENTRIES) {
                    throw unavailable('The AI session directory exceeds the discovery limit. Remove obsolete session files before retrying.');
                }
                if (!entry.name.startsWith('session-') || !entry.isDirectory() || entry.isSymbolicLink()) { continue; }
                if (files.length >= MAX_SESSION_DIRECTORIES) {
                    throw unavailable('Too many AI session directories are present. Remove obsolete sessions before retrying.');
                }
                files.push(path.join(this.sessionDirectory, entry.name, 'session.json'));
            }
            return files.sort();
        } catch (error) {
            this.assertActive(signal);
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
            if (error instanceof AiBridgeError) { throw error; }
            throw unavailable('The AI session directory could not be inspected. Reconnect the bridge in VS Code.');
        }
    }

    private async discover(signal: AbortSignal): Promise<AiIpcClient> {
        const probes = new Set<AiIpcClient>();
        try {
            const files = await this.sessionFiles(signal);
            const live: AiIpcClient[] = [];
            const seen = new Set<string>();
            for (const file of files) {
                this.assertActive(signal);
                let descriptor: Awaited<ReturnType<typeof readSessionDescriptor>>;
                try { descriptor = await readSessionDescriptor(file); }
                catch { this.assertActive(signal); continue; }
                this.assertActive(signal);
                if (!samePath(descriptor.sketchPath, this.sketchPath) || seen.has(descriptor.sessionId)) { continue; }
                seen.add(descriptor.sessionId);
                let client: AiIpcClient;
                if (this.current?.connected && this.current.sessionId === descriptor.sessionId) {
                    client = this.current;
                } else {
                    try { client = await AiIpcClient.connect(file, signal); }
                    catch (error) {
                        this.assertActive(signal);
                        if (definitelyStale(error)) { continue; }
                        throw unavailable('A matching AI session could not be authenticated. Close or reconnect that VS Code session before retrying.');
                    }
                    probes.add(client);
                    this.assertActive(signal);
                    if (!samePath(client.sketchPath, this.sketchPath) || client.sessionId !== descriptor.sessionId) {
                        throw unavailable('The AI session changed during discovery. Retry after reconnecting it in VS Code.');
                    }
                }
                live.push(client);
                if (live.length > 1) {
                    throw new AiBridgeError('AMBIGUOUS_SESSION', 'More than one VS Code window has an AI session connected for this sketch. Disconnect the extra sessions and retry.');
                }
            }
            this.assertActive(signal);
            const selected = live[0];
            if (!selected?.connected) { throw unavailable(); }
            const previous = this.current;
            this.current = selected;
            probes.delete(selected);
            if (previous !== selected) { previous?.dispose(); }
            return selected;
        } finally {
            for (const client of probes) { client.dispose(); }
        }
    }
}
