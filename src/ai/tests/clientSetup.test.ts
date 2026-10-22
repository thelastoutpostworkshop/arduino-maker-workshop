import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, type TestContext } from 'node:test';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { setupAiClient, type AiClientSetupOptions } from '../clientSetup';

const SERVER = 'arduino_maker_workshop';
const args = ['C:\\Example User\\AI "Bridge"\\launcher.cjs', '--session-dir', 'C:\\Example User\\ai-bridge'];

async function fixture(context: TestContext) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-client-setup-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const options: AiClientSetupOptions = { homeDirectory: root, environment: {} };
    return {
        root, options,
        codex: path.join(root, '.codex', 'config.toml'), claude: path.join(root, '.claude.json'),
        async write(file: string, text: string) {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, text);
        },
    };
}

async function codexConfig(file: string): Promise<Record<string, any>> {
    return getStaticTOMLValue(parseTOML(await fs.readFile(file, 'utf8'))) as Record<string, any>;
}

async function backups(file: string): Promise<string[]> {
    return (await fs.readdir(path.dirname(file))).filter(name => name.startsWith(path.basename(file) + '.amw-backup-'));
}

test('setup creates global client configuration without installed client CLIs and is idempotent', async context => {
    const f = await fixture(context);
    for (const client of ['codex', 'claude'] as const) {
        const expectedPath = client === 'codex' ? f.codex : f.claude;
        assert.deepEqual(await setupAiClient(client, args, f.options), { configPath: expectedPath, changed: true });
        const content = await fs.readFile(expectedPath, 'utf8');
        const config = client === 'codex' ? await codexConfig(expectedPath) : JSON.parse(content);
        const server = (client === 'codex' ? config.mcp_servers : config.mcpServers)[SERVER];
        assert.equal(server.command, 'node');
        assert.deepEqual(server.args, args);
        if (client === 'codex') { assert.equal(server.tool_timeout_sec, 900); assert.equal(server.enabled, true); }
        else { assert.equal(server.type, 'stdio'); }
        assert.deepEqual(await setupAiClient(client, args, f.options), { configPath: expectedPath, changed: false });
        assert.equal(await fs.readFile(expectedPath, 'utf8'), content);
        assert.deepEqual(await backups(expectedPath), []);
    }
});

test('Codex setup preserves unrelated TOML text, environment and tool permissions while replacing its transport', async context => {
    const f = await fixture(context);
    const original = [
        '# Keep my preferences exactly',
        'model = "chosen-model"',
        'unusual_integer = 9223372036854775807',
        'date = 1979-05-27T07:32:00Z',
        'notes = """',
        '[mcp_servers.arduino_maker_workshop]',
        'This is only a string, not a real server table.',
        '"""',
        '[mcp_servers.other]',
        'command = "other-command" # keep this comment',
        '[mcp_servers."arduino_maker_workshop"]',
        'url = "https://old.invalid/mcp"',
        'args = [',
        '  "old-argument", # old launch arguments',
        '  "another-argument",',
        ']',
        'enabled = false # explicitly enable this server',
        'disabled_tools = ["compile_sketch"]',
        'env = { KEEP = "local-value" }',
        '[mcp_servers.arduino_maker_workshop.http_headers]',
        'Authorization = "old-value"',
        '[mcp_servers.arduino_maker_workshop.tools.compile_sketch]',
        'approval_mode = "prompt" # keep user tool settings',
        '',
    ].join('\r\n');
    await f.write(f.codex, original);
    await setupAiClient('codex', args, f.options);
    const next = await fs.readFile(f.codex, 'utf8');
    const config = await codexConfig(f.codex);
    assert.ok(next.startsWith(original.slice(0, original.indexOf('[mcp_servers."arduino_maker_workshop"]'))));
    assert.ok(next.includes('approval_mode = "prompt" # keep user tool settings'));
    const server = config.mcp_servers[SERVER];
    assert.equal(server.enabled, true);
    assert.deepEqual(server.env, { KEEP: 'local-value' });
    assert.deepEqual(server.disabled_tools, ['compile_sketch']);
    assert.equal(server.tools.compile_sketch.approval_mode, 'prompt');
    assert.equal(server.url, undefined);
    assert.equal(server.http_headers, undefined);
    const saved = await backups(f.codex);
    assert.equal(saved.length, 1);
    assert.equal(await fs.readFile(path.join(path.dirname(f.codex), saved[0]), 'utf8'), original);
    if (process.platform !== 'win32') { assert.equal((await fs.stat(path.join(path.dirname(f.codex), saved[0]))).mode & 0o077, 0); }
    assert.equal((await setupAiClient('codex', args, f.options)).changed, false);
    assert.equal((await backups(f.codex)).length, 1);
});

test('Codex setup supports dotted keys, inline tables and implicit parent tables', async context => {
    const f = await fixture(context);
    const layouts = [
        'mcp_servers.arduino_maker_workshop.command = "old"\nmcp_servers.other.command = "other"\n',
        '[mcp_servers]\narduino_maker_workshop.command = "old"\nother.command = "other"\n',
        'mcp_servers = { other = { command = "other" }, arduino_maker_workshop = { command = "old", env = { KEEP = "value" }, enabled_tools = ["get_project_context"] } }\n',
        '[mcp_servers]\narduino_maker_workshop = { command = "old", disabled_tools = ["compile_sketch"] }\n',
        '[mcp_servers.arduino_maker_workshop.env]\nKEEP = "value"\n',
    ];
    for (const original of layouts) {
        await f.write(f.codex, original);
        await setupAiClient('codex', args, f.options);
        const config = await codexConfig(f.codex);
        assert.equal(config.mcp_servers[SERVER].command, 'node');
        assert.deepEqual(config.mcp_servers[SERVER].args, args);
        assert.equal(config.mcp_servers[SERVER].tool_timeout_sec, 900);
        if (original.includes('KEEP')) { assert.deepEqual(config.mcp_servers[SERVER].env, { KEEP: 'value' }); }
        if (original.includes('"other"')) { assert.equal(config.mcp_servers.other.command, 'other'); }
        if (original.includes('enabled_tools')) { assert.deepEqual(config.mcp_servers[SERVER].enabled_tools, ['get_project_context']); }
        if (original.includes('disabled_tools')) { assert.deepEqual(config.mcp_servers[SERVER].disabled_tools, ['compile_sketch']); }
    }
});

test('Claude setup preserves unrelated settings and project choices while enabling the global owned entry', async context => {
    const f = await fixture(context);
    const original = {
        theme: 'dark', permissions: { deny: ['Bash(*)'] },
        disabledMcpServers: [SERVER, 'other'],
        projects: { '/a-project': { disabledMcpServers: [SERVER], mcpServers: { [SERVER]: { command: 'project-override' } } } },
        mcpServers: {
            other: { type: 'http', url: 'https://other.invalid/mcp' },
            [SERVER]: { type: 'http', url: 'https://old.invalid/mcp', headers: { Token: 'old' }, env: { KEEP: 'value' }, disabled: true, customPermissions: ['read'] },
        },
    };
    await f.write(f.claude, JSON.stringify(original, null, 4) + '\n');
    await setupAiClient('claude', args, f.options);
    const config = JSON.parse(await fs.readFile(f.claude, 'utf8'));
    assert.deepEqual(config.projects, original.projects);
    assert.deepEqual(config.permissions, original.permissions);
    assert.deepEqual(config.mcpServers.other, original.mcpServers.other);
    assert.deepEqual(config.disabledMcpServers, ['other']);
    assert.deepEqual(config.mcpServers[SERVER], { type: 'stdio', env: { KEEP: 'value' }, disabled: false, customPermissions: ['read'], command: 'node', args });
    assert.equal((await backups(f.claude)).length, 1);
});

test('setup respects explicit client config directories and rejects relative overrides', async context => {
    const f = await fixture(context);
    const codexHome = path.join(f.root, 'codex-custom');
    const claudeHome = path.join(f.root, 'claude-custom');
    const options = { ...f.options, environment: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome } };
    assert.equal((await setupAiClient('codex', args, options)).configPath, path.join(codexHome, 'config.toml'));
    assert.equal((await setupAiClient('claude', args, options)).configPath, path.join(claudeHome, '.claude.json'));
    await assert.rejects(setupAiClient('codex', args, { ...f.options, environment: { CODEX_HOME: 'relative' } }), { code: 'INVALID_ARGUMENTS' });
    await assert.rejects(fs.stat(f.codex), { code: 'ENOENT' });
    await assert.rejects(fs.stat(f.claude), { code: 'ENOENT' });
});

test('invalid syntax and conflicting server shapes remain byte-for-byte unchanged', async context => {
    const f = await fixture(context);
    for (const [client, file, invalid] of [
        ['codex', f.codex, '[broken'], ['codex', f.codex, 'mcp_servers = []'],
        ['codex', f.codex, 'mcp_servers.arduino_maker_workshop = "not a table"'],
        ['claude', f.claude, '{broken'], ['claude', f.claude, '[]'],
        ['claude', f.claude, '{"mcpServers":{"arduino_maker_workshop":null}}'],
    ] as const) {
        await f.write(file, invalid);
        await assert.rejects(setupAiClient(client, args, f.options), { code: 'INVALID_CLIENT_CONFIG' });
        assert.equal(await fs.readFile(file, 'utf8'), invalid);
        assert.deepEqual(await backups(file), []);
        assert.equal((await fs.readdir(path.dirname(file))).some(name => name.endsWith('.amw-setup.lock') || name.endsWith('.tmp')), false);
    }
});

test('setup detects concurrent external changes and never overwrites the new contents', async context => {
    const f = await fixture(context);
    for (const exists of [false, true]) {
        if (exists) { await f.write(f.codex, 'model = "old"\n'); }
        const changed = 'model = "external-edit"\n';
        await assert.rejects(setupAiClient('codex', args, {
            ...f.options, beforeCommit: async file => { await fs.writeFile(file, changed); },
        }), { code: 'CLIENT_CONFIG_CHANGED' });
        assert.equal(await fs.readFile(f.codex, 'utf8'), changed);
    }
});

test('simultaneous setup commands serialize with an exclusive lock and cleanup after completion', async context => {
    const f = await fixture(context);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const first = setupAiClient('claude', args, { ...f.options, beforeCommit: async () => { entered(); await held; } });
    await started;
    try { await assert.rejects(setupAiClient('claude', ['other-launcher'], f.options), { code: 'CLIENT_SETUP_BUSY' }); }
    finally { release(); }
    await first;
    const config = JSON.parse(await fs.readFile(f.claude, 'utf8'));
    assert.deepEqual(config.mcpServers[SERVER].args, args);
    assert.equal((await fs.readdir(f.root)).some(name => name.endsWith('.amw-setup.lock') || name.endsWith('.tmp')), false);
});
