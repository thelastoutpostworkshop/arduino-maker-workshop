import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseTOML, getStaticTOMLValue, type AST } from 'toml-eslint-parser';
import { AiBridgeError } from './contracts';

const SERVER = 'arduino_maker_workshop';
const MAX_CONFIG_BYTES = 16 * 1024 * 1024;
const TOML_PREFIX = ['mcp_servers', SERVER];
const CODEX_REMOTE_FIELDS = new Set(['url', 'auth', 'bearer_token_env_var', 'http_headers', 'env_http_headers', 'http_headers_helper', 'oauth', 'experimental_environment', 'type', 'transport']);
const CLAUDE_REMOTE_FIELDS = ['url', 'headers', 'headersHelper', 'oauth', 'auth', 'bearerToken', 'transport'];

export interface AiClientLaunch {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface AiClientSetupOptions {
    homeDirectory?: string;
    environment?: NodeJS.ProcessEnv;
    /** Injectable synchronization point for testing concurrent external edits. */
    beforeCommit?: (configPath: string) => Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function invalidConfig(): AiBridgeError {
    return new AiBridgeError('INVALID_CLIENT_CONFIG', 'The client configuration is invalid or has a conflicting server structure. Fix it before running setup; its contents were not replaced.');
}

function validEnvironment(value: unknown): value is Record<string, string> {
    return record(value) && Object.entries(value).every(([key, entry]) => key.length > 0 && !/[=\0]/.test(key) &&
        typeof entry === 'string' && !entry.includes('\0'));
}

function mergeEnvironment(previous: unknown, required: Record<string, string>): Record<string, string> {
    if (previous !== undefined && !validEnvironment(previous)) { throw invalidConfig(); }
    return { ...(previous as Record<string, string> | undefined), ...required };
}

function serverMap(config: Record<string, unknown>, key: string): Record<string, unknown> {
    if (config[key] === undefined) { config[key] = {}; }
    if (!record(config[key])) { throw invalidConfig(); }
    const servers = config[key] as Record<string, unknown>;
    if (servers[SERVER] !== undefined && !record(servers[SERVER])) { throw invalidConfig(); }
    return servers;
}

function mergeClaude(text: string, launch: AiClientLaunch): string {
    let config: unknown;
    try { config = text.trim() ? JSON.parse(text) : {}; } catch { throw invalidConfig(); }
    if (!record(config)) { throw invalidConfig(); }
    const before = JSON.stringify(config);
    const servers = serverMap(config, 'mcpServers');
    const previous = servers[SERVER] as Record<string, unknown> | undefined;
    const server = { ...previous, type: 'stdio', command: launch.command, args: launch.args, env: mergeEnvironment(previous?.env, launch.env) } as Record<string, unknown>;
    for (const key of CLAUDE_REMOTE_FIELDS) { delete server[key]; }
    if ('disabled' in server) { server.disabled = false; }
    if ('enabled' in server) { server.enabled = true; }
    servers[SERVER] = server;
    // Project-local choices and tool permissions are deliberately preserved.
    if (config.disabledMcpServers !== undefined) {
        if (!Array.isArray(config.disabledMcpServers) || config.disabledMcpServers.some(value => typeof value !== 'string')) { throw invalidConfig(); }
        config.disabledMcpServers = config.disabledMcpServers.filter(value => value !== SERVER);
    }
    if (JSON.stringify(config) === before) { return text; }
    const indent = text.match(/\n([\t ]+)"/)?.[1] ?? '  ';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return JSON.stringify(config, null, indent).replace(/\n/g, eol) + eol;
}

interface Edit { start: number; end: number; text: string; }

function keys(key: AST.TOMLKey): string[] {
    return key.keys.map(part => part.type === 'TOMLBare' ? part.name : part.value);
}

function prefix(value: readonly (string | number)[], expected: readonly string[]): boolean {
    return value.length >= expected.length && expected.every((part, index) => value[index] === part);
}

function tomlKey(parts: string[]): string { return parts.map(part => JSON.stringify(part)).join('.'); }

/** AST ranges preserve unrelated TOML, including quoted/dotted keys and multiline strings. */
function mergeCodex(text: string, launch: AiClientLaunch): string {
    let ast: AST.TOMLProgram;
    let config: unknown;
    try { ast = parseTOML(text); config = getStaticTOMLValue(ast); } catch { throw invalidConfig(); }
    if (!record(config)) { throw invalidConfig(); }
    const servers = serverMap(config, 'mcp_servers');
    const previous = servers[SERVER] as Record<string, unknown> | undefined;
    const environment = mergeEnvironment(previous?.env, launch.env);
    const desired = new Map<string, unknown>([['command', launch.command], ['args', launch.args], ['tool_timeout_sec', 900], ['enabled', true]]);
    const expected: Record<string, unknown> = { ...previous, ...Object.fromEntries(desired), env: environment };
    for (const key of CODEX_REMOTE_FIELDS) { delete expected[key]; }
    if (isDeepStrictEqual(previous, expected)) { return text; }
    servers[SERVER] = expected;
    const rendered = new Map([...desired].map(([key, value]) => [key, JSON.stringify(value)]));
    const edits: Edit[] = [];
    const top = ast.body[0];
    const eol = text.includes('\r\n') ? '\r\n' : '\n';

    const inlineEnvironment = (table?: AST.TOMLInlineTable): string => {
        const done = new Set<string>();
        const parts = (table?.body ?? []).map(item => {
            const key = keys(item.key)[0];
            done.add(key);
            return Object.hasOwn(launch.env, key) ? `${text.slice(item.key.range[0], item.key.range[1])} = ${JSON.stringify(launch.env[key])}` :
                text.slice(item.range[0], item.range[1]);
        });
        for (const [key, value] of Object.entries(launch.env)) {
            if (!done.has(key)) { parts.push(`${JSON.stringify(key)} = ${JSON.stringify(value)}`); }
        }
        return `{ ${parts.join(', ')} }`;
    };

    const inlineServer = (items: AST.TOMLKeyValue[] = [], keyOffset = 0): string => {
        const parts: string[] = [];
        const done = new Set<string>();
        const envDone = new Set<string>();
        let hasEnvironment = false;
        for (const item of items) {
            const key = keys(item.key).slice(keyOffset);
            const keyStart = item.key.keys[keyOffset].range[0];
            const keyText = text.slice(keyStart, item.key.range[1]);
            if (CODEX_REMOTE_FIELDS.has(key[0])) { continue; }
            if (key[0] === 'env') {
                hasEnvironment = true;
                if (key.length === 1) {
                    if (item.value.type !== 'TOMLInlineTable') { throw invalidConfig(); }
                    parts.push(`${keyText} = ${inlineEnvironment(item.value)}`);
                    Object.keys(launch.env).forEach(name => envDone.add(name));
                } else {
                    const name = key[1];
                    envDone.add(name);
                    parts.push(Object.hasOwn(launch.env, name) ? `${keyText} = ${JSON.stringify(launch.env[name])}` :
                        text.slice(keyStart, item.range[1]));
                }
            } else if (rendered.has(key[0])) {
                if (!done.has(key[0])) { parts.push(`${JSON.stringify(key[0])} = ${rendered.get(key[0])}`); done.add(key[0]); }
            } else { parts.push(text.slice(keyStart, item.range[1])); }
        }
        for (const [key, value] of rendered) { if (!done.has(key)) { parts.push(`${JSON.stringify(key)} = ${value}`); } }
        if (!hasEnvironment) { parts.push(`env = ${inlineEnvironment()}`); }
        else {
            for (const [key, value] of Object.entries(launch.env)) {
                if (!envDone.has(key)) { parts.push(`${tomlKey(['env', key])} = ${JSON.stringify(value)}`); }
            }
        }
        return `{ ${parts.join(', ')} }`;
    };

    const rewriteAncestor = (table: AST.TOMLInlineTable, base: string[]): string => {
        if (base.length === TOML_PREFIX.length) { return inlineServer(table.body); }
        const descendants = table.body.filter(item => {
            const full = [...base, ...keys(item.key)];
            return full.length > TOML_PREFIX.length && prefix(full, TOML_PREFIX);
        });
        if (descendants.length) {
            // Dotted entries can define the server implicitly inside a closed ancestor.
            // Collect only this server's entries and retain the other inline settings.
            let inserted = false;
            const parts = table.body.flatMap(item => {
                if (!descendants.includes(item)) { return [text.slice(item.range[0], item.range[1])]; }
                if (inserted) { return []; }
                inserted = true;
                return [`${tomlKey(TOML_PREFIX.slice(base.length))} = ${inlineServer(descendants, TOML_PREFIX.length - base.length)}`];
            });
            return `{ ${parts.join(', ')} }`;
        }
        let found = false;
        const parts = table.body.map(item => {
            const full = [...base, ...keys(item.key)];
            if (!prefix(TOML_PREFIX, full)) { return text.slice(item.range[0], item.range[1]); }
            if (item.value.type !== 'TOMLInlineTable') { throw invalidConfig(); }
            found = true;
            return `${text.slice(item.key.range[0], item.key.range[1])} = ${rewriteAncestor(item.value, full)}`;
        });
        if (!found) { parts.push(`${tomlKey(TOML_PREFIX.slice(base.length))} = ${inlineServer()}`); }
        return `{ ${parts.join(', ')} }`;
    };

    // Inline tables are closed in TOML. Update their contained server in place.
    let inline = false;
    for (const container of [top, ...top.body.filter((node): node is AST.TOMLTable => node.type === 'TOMLTable')]) {
        const base = container.type === 'TOMLTable' ? container.resolvedKey : [];
        for (const item of container.body) {
            if (item.type !== 'TOMLKeyValue') { continue; }
            const full = [...base, ...keys(item.key)];
            if (full.some(part => typeof part !== 'string') || !prefix(TOML_PREFIX, full as string[])) { continue; }
            if (item.value.type !== 'TOMLInlineTable') { throw invalidConfig(); }
            edits.push({ start: item.value.range[0], end: item.value.range[1], text: rewriteAncestor(item.value, full as string[]) });
            inline = true;
        }
    }

    if (!inline) {
        const done = new Set<string>();
        const envDone = new Set<string>();
        let envInsertion: AST.TOMLTable | undefined;
        let insertion: AST.TOMLTopLevelTable | AST.TOMLTable | undefined;
        for (const container of [top, ...top.body.filter((node): node is AST.TOMLTable => node.type === 'TOMLTable')]) {
            const base = container.type === 'TOMLTable' ? container.resolvedKey : [];
            if (container.type === 'TOMLTable' && prefix(base, TOML_PREFIX) && base.length > 2 &&
                (CODEX_REMOTE_FIELDS.has(String(base[2])) || rendered.has(String(base[2])))) {
                edits.push({ start: container.range[0], end: container.range[1], text: '' });
                continue;
            }
            if (container.type === 'TOMLTable' && base.length === 2 && prefix(base, TOML_PREFIX)) { insertion = container; }
            if (container.type === 'TOMLTable' && base.length === 3 && prefix(base, [...TOML_PREFIX, 'env'])) { envInsertion = container; }
            for (const item of container.body) {
                if (item.type !== 'TOMLKeyValue') { continue; }
                const full = [...base, ...keys(item.key)];
                if (!prefix(full, TOML_PREFIX) || full.length < 3) { continue; }
                if (prefix(TOML_PREFIX, base as string[]) && base.length < 2) { insertion ??= container; }
                const field = String(full[2]);
                if (field === 'env') {
                    if (full.length === 3) {
                        if (item.value.type !== 'TOMLInlineTable') { throw invalidConfig(); }
                        edits.push({ start: item.value.range[0], end: item.value.range[1], text: inlineEnvironment(item.value) });
                        Object.keys(launch.env).forEach(name => envDone.add(name));
                    } else if (full.length === 4 && Object.hasOwn(launch.env, String(full[3]))) {
                        const name = String(full[3]);
                        edits.push({ start: item.value.range[0], end: item.value.range[1], text: JSON.stringify(launch.env[name]) });
                        envDone.add(name);
                    }
                } else if (CODEX_REMOTE_FIELDS.has(field) || (rendered.has(field) && full.length !== 3)) {
                    edits.push({ start: item.range[0], end: item.range[1], text: '' });
                } else if (rendered.has(field)) {
                    edits.push({ start: item.value.range[0], end: item.value.range[1], text: rendered.get(field)! });
                    done.add(field);
                }
            }
        }
        const missing: [string[], string][] = [...rendered].filter(([key]) => !done.has(key)).map(([key, value]) => [[key], value]);
        const envMissing = Object.entries(launch.env).filter(([key]) => !envDone.has(key));
        if (previous?.env === undefined) { missing.push([['env'], inlineEnvironment()]); }
        else if (envInsertion && envMissing.length) {
            const newline = text.indexOf('\n', envInsertion.key.range[1]);
            const at = newline === -1 ? text.length : newline + 1;
            const lines = envMissing.map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(eol) + eol;
            edits.push({ start: at, end: at, text: (at > 0 && text[at - 1] !== '\n' ? eol : '') + lines });
        } else { missing.push(...envMissing.map(([key, value]): [string[], string] => [['env', key], JSON.stringify(value)])); }
        if (missing.length) {
            const base = insertion?.type === 'TOMLTable' ? insertion.resolvedKey.length : 0;
            if (insertion) {
                const newline = insertion.type === 'TOMLTable' ? text.indexOf('\n', insertion.key.range[1]) : -1;
                const at = insertion.type === 'TOMLTopLevelTable' ? 0 : newline === -1 ? text.length : newline + 1;
                const lines = missing.map(([key, value]) => `${tomlKey([...TOML_PREFIX.slice(base), ...key])} = ${value}`).join(eol) + eol;
                edits.push({ start: at, end: at, text: (at > 0 && text[at - 1] !== '\n' ? eol : '') + lines });
            } else {
                const block = `[mcp_servers.${SERVER}]${eol}${missing.map(([key, value]) => `${tomlKey(key)} = ${value}`).join(eol)}${eol}`;
                edits.push({ start: text.length, end: text.length, text: (text && !text.endsWith('\n') ? eol : '') + eol + block });
            }
        }
    }
    let next = text;
    // Apply same-position insertions in reverse order so their final text keeps
    // declaration order (environment entries must precede a following table).
    for (const edit of edits.map((edit, order) => ({ ...edit, order })).sort((left, right) => right.start - left.start || right.end - left.end || right.order - left.order)) {
        next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    try {
        if (!isDeepStrictEqual(getStaticTOMLValue(parseTOML(next)), config)) { throw invalidConfig(); }
    } catch { throw invalidConfig(); }
    return next;
}

interface Snapshot { bytes: Buffer; stat: Awaited<ReturnType<typeof fs.lstat>>; }

async function snapshot(file: string): Promise<Snapshot | undefined> {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) { throw invalidConfig(); }
        const bytes = await fs.readFile(file);
        if (bytes.length > MAX_CONFIG_BYTES) { throw invalidConfig(); }
        return { bytes, stat };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
        throw error;
    }
}

function sameSnapshot(left: Snapshot | undefined, right: Snapshot | undefined): boolean {
    return !left || !right ? left === right : left.bytes.equals(right.bytes) &&
        left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino &&
        left.stat.mtimeMs === right.stat.mtimeMs && left.stat.ctimeMs === right.stat.ctimeMs;
}

export async function setupAiClient(client: 'codex' | 'claude', launch: AiClientLaunch, options: AiClientSetupOptions = {}): Promise<{ configPath: string; changed: boolean }> {
    if ((client !== 'codex' && client !== 'claude') || !record(launch) || typeof launch.command !== 'string' || !path.isAbsolute(launch.command) || launch.command.includes('\0') ||
        !Array.isArray(launch.args) || !launch.args.length || launch.args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !validEnvironment(launch.env)) {
        throw new AiBridgeError('INVALID_ARGUMENTS', 'A supported AI client, absolute runtime path, valid launcher arguments and environment are required.');
    }
    const environment = options.environment ?? process.env;
    const home = options.homeDirectory ?? os.homedir();
    const configured = client === 'codex' ? environment.CODEX_HOME : environment.CLAUDE_CONFIG_DIR;
    const directory = configured || (client === 'codex' ? path.join(home, '.codex') : home);
    if (!path.isAbsolute(directory)) { throw new AiBridgeError('INVALID_ARGUMENTS', 'The client configuration directory must be an absolute path.'); }
    const configPath = path.join(directory, client === 'codex' ? 'config.toml' : '.claude.json');
    const lockPath = configPath + '.amw-setup.lock';
    const temporary = path.join(directory, `.${path.basename(configPath)}.amw-${crypto.randomUUID()}.tmp`);
    try { await fs.mkdir(directory, { recursive: true, mode: 0o700 }); }
    catch { throw new AiBridgeError('CLIENT_SETUP_FAILED', 'The client configuration directory could not be created. Check its path and permissions.'); }
    let lock: Awaited<ReturnType<typeof fs.open>>;
    try { lock = await fs.open(lockPath, 'wx', 0o600); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new AiBridgeError('CLIENT_SETUP_BUSY', `Another setup may be using this configuration. Retry when it finishes. If no setup is running, remove the stale lock: ${lockPath}`);
        }
        throw new AiBridgeError('CLIENT_SETUP_FAILED', 'The client configuration directory is not writable.');
    }
    try {
        const original = await snapshot(configPath);
        const text = original?.bytes.toString('utf8') ?? '';
        if (original && !Buffer.from(text, 'utf8').equals(original.bytes)) { throw invalidConfig(); }
        const next = client === 'codex' ? mergeCodex(text, launch) : mergeClaude(text, launch);
        if (next === text) { return { configPath, changed: false }; }
        const output = await fs.open(temporary, 'wx', original ? Number(original.stat.mode) & 0o777 : 0o600);
        try { await output.writeFile(next, 'utf8'); await output.sync(); } finally { await output.close(); }
        await options.beforeCommit?.(configPath);
        if (!sameSnapshot(original, await snapshot(configPath))) {
            throw new AiBridgeError('CLIENT_CONFIG_CHANGED', 'The client configuration changed during setup. No update was applied; run setup again.');
        }
        if (original) {
            await fs.writeFile(`${configPath}.amw-backup-${Date.now()}-${crypto.randomUUID()}`, original.bytes, { flag: 'wx', mode: 0o600 });
            if (!sameSnapshot(original, await snapshot(configPath))) {
                throw new AiBridgeError('CLIENT_CONFIG_CHANGED', 'The client configuration changed during setup. No update was applied; run setup again.');
            }
            await fs.rename(temporary, configPath);
        } else {
            // An exclusive link prevents overwriting a configuration created during setup.
            try { await fs.link(temporary, configPath); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                    throw new AiBridgeError('CLIENT_CONFIG_CHANGED', 'A client configuration was created during setup. Run setup again to merge it.');
                }
                throw error;
            }
        }
        return { configPath, changed: true };
    } catch (error) {
        if (error instanceof AiBridgeError) { throw error; }
        throw new AiBridgeError('CLIENT_SETUP_FAILED', 'Could not safely update the client configuration. Check its permissions and retry.');
    } finally {
        await fs.unlink(temporary).catch(() => {});
        await lock.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
    }
}
