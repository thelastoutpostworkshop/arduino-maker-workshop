import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AiBridgeError } from './contracts';
import { AiIpcClient, readSessionDescriptor } from './ipcServer';

const MAX_DIRECTORY_ENTRIES = 512;
const MAX_SESSION_DIRECTORIES = 128;
const DISCOVERY_TIMEOUT_MS = 5000;

function samePath(left: string, right: string): boolean {
    return pathKey(left) === pathKey(right);
}

function pathKey(value: string): string { return process.platform === 'win32' ? value.toLowerCase() : value; }

function unavailable(message = 'No live AI session is connected for this sketch. Enable AI integration in its VS Code window and retry.'): AiBridgeError {
    return new AiBridgeError('SESSION_UNAVAILABLE', message);
}

function definitelyStale(error: unknown): boolean {
    const cause = error instanceof Error ? (error as Error & { cause?: NodeJS.ErrnoException }).cause : undefined;
    return cause?.code === 'ENOENT' || cause?.code === 'ECONNREFUSED';
}

export interface AiSketchList {
    schemaVersion: 1;
    sketches: Array<{ sketchPath: string; sessionCount: number }>;
}

/** Authenticated discovery of enabled sessions, with an explicit sketch target for each operation. */
export class AiSessionResolver {
    private readonly current = new Map<string, AiIpcClient>();
    private readonly pending = new Map<string, Promise<unknown>>();
    private readonly discoveryAborts = new Set<AbortController>();
    private disposed = false;

    private constructor(private readonly sessionDirectory: string) {}

    static async createGlobal(sessionDirectory: string): Promise<AiSessionResolver> {
        if (!path.isAbsolute(sessionDirectory)) {
            throw new AiBridgeError('INVALID_ARGUMENTS', 'An absolute session-directory path is required.');
        }
        return new AiSessionResolver(path.resolve(sessionDirectory));
    }

    private static async canonicalSketch(sketchPath: string): Promise<string> {
        try {
            const canonicalSketch = await fs.realpath(sketchPath);
            if (!(await fs.stat(canonicalSketch)).isDirectory()) { throw new Error(); }
            return canonicalSketch;
        } catch { throw unavailable('The requested sketch folder is unavailable. Check its absolute path and retry.'); }
    }

    getClient(requestedSketchPath: string): Promise<AiIpcClient> {
        if (this.disposed) { return Promise.reject(unavailable('The AI session resolver is closed.')); }
        if (typeof requestedSketchPath !== 'string' || !path.isAbsolute(requestedSketchPath)) {
            return Promise.reject(new AiBridgeError('INVALID_ARGUMENTS', 'An explicit absolute sketchPath is required. List connected sketches before choosing a target.'));
        }
        return AiSessionResolver.canonicalSketch(requestedSketchPath).then(canonical => this.getSketchClient(canonical));
    }

    listSketches(): Promise<AiSketchList> {
        return this.runDiscovery('list', signal => this.discoverSketches(signal));
    }

    private getSketchClient(sketchPath: string): Promise<AiIpcClient> {
        return this.runDiscovery(`sketch:${pathKey(sketchPath)}`, signal => this.discoverClient(sketchPath, signal));
    }

    private runDiscovery<T>(key: string, discover: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (this.disposed) { return Promise.reject(unavailable('The AI session resolver is closed.')); }
        const existing = this.pending.get(key);
        if (existing) { return existing as Promise<T>; }
        for (const [sketch, client] of this.current) {
            if (!client.connected) { client.dispose(); this.current.delete(sketch); }
        }
        const controller = new AbortController();
        this.discoveryAborts.add(controller);
        const timer = setTimeout(() => controller.abort(unavailable('Finding the VS Code AI session timed out. Check its connection and retry.')), DISCOVERY_TIMEOUT_MS);
        timer.unref();
        let removeAbort = () => {};
        const interrupted = new Promise<never>((_resolve, reject) => {
            const abort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
            removeAbort = () => controller.signal.removeEventListener('abort', abort);
        });
        const pending = Promise.race([discover(controller.signal), interrupted]).finally(() => {
            clearTimeout(timer);
            removeAbort();
            if (this.pending.get(key) === pending) { this.pending.delete(key); }
            this.discoveryAborts.delete(controller);
        });
        this.pending.set(key, pending);
        return pending;
    }

    dispose(): void {
        this.disposed = true;
        for (const controller of this.discoveryAborts) { controller.abort(unavailable('The AI session resolver is closed.')); }
        for (const client of this.current.values()) { client.dispose(); }
        this.current.clear();
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

    private async discoverClient(sketchPath: string, signal: AbortSignal): Promise<AiIpcClient> {
        const probes = new Set<AiIpcClient>();
        try {
            const live = await this.scan(signal, probes, sketchPath, true);
            this.assertActive(signal);
            const selected = live[0];
            if (!selected?.connected) { throw unavailable(); }
            const key = pathKey(sketchPath);
            const previous = this.current.get(key);
            if (!previous && this.current.size >= MAX_SESSION_DIRECTORIES) {
                throw unavailable('Too many active sketch connections are cached. Disconnect unused VS Code sessions and retry.');
            }
            this.current.set(key, selected);
            probes.delete(selected);
            if (previous !== selected) { previous?.dispose(); }
            return selected;
        } finally {
            for (const client of probes) { client.dispose(); }
        }
    }

    private async discoverSketches(signal: AbortSignal): Promise<AiSketchList> {
        const probes = new Set<AiIpcClient>();
        try {
            const clients = await this.scan(signal, probes);
            this.assertActive(signal);
            const sketches = new Map<string, { sketchPath: string; sessionCount: number }>();
            for (const client of clients) {
                if (!client.connected) { continue; }
                const key = pathKey(client.sketchPath);
                const sketch = sketches.get(key);
                if (sketch) { sketch.sessionCount++; }
                else { sketches.set(key, { sketchPath: client.sketchPath, sessionCount: 1 }); }
            }
            return { schemaVersion: 1, sketches: [...sketches.values()].sort((left, right) => left.sketchPath.localeCompare(right.sketchPath)) };
        } finally {
            for (const client of probes) { client.dispose(); }
        }
    }

    private async scan(signal: AbortSignal, probes: Set<AiIpcClient>, sketchPath?: string, requireUnique = false): Promise<AiIpcClient[]> {
        const files = await this.sessionFiles(signal);
        const live: AiIpcClient[] = [];
        const seen = new Set<string>();
        for (const file of files) {
            this.assertActive(signal);
            let descriptor: Awaited<ReturnType<typeof readSessionDescriptor>>;
            try { descriptor = await readSessionDescriptor(file); }
            catch { this.assertActive(signal); continue; }
            this.assertActive(signal);
            if ((sketchPath && !samePath(descriptor.sketchPath, sketchPath)) || seen.has(descriptor.sessionId)) { continue; }
            seen.add(descriptor.sessionId);
            let client = this.current.get(pathKey(descriptor.sketchPath));
            if (!client?.connected || client.sessionId !== descriptor.sessionId) {
                try { client = await AiIpcClient.connect(file, signal); }
                catch (error) {
                    this.assertActive(signal);
                    if (definitelyStale(error)) { continue; }
                    throw unavailable('A matching AI session could not be authenticated. Close or reconnect that VS Code session before retrying.');
                }
                probes.add(client);
                this.assertActive(signal);
                if (!samePath(client.sketchPath, descriptor.sketchPath) || client.sessionId !== descriptor.sessionId) {
                    throw unavailable('The AI session changed during discovery. Retry after reconnecting it in VS Code.');
                }
            }
            live.push(client);
            if (requireUnique && live.length > 1) {
                throw new AiBridgeError('AMBIGUOUS_SESSION', 'More than one VS Code window has an AI session connected for this sketch. Disconnect the extra sessions and retry.');
            }
        }
        return live;
    }
}
