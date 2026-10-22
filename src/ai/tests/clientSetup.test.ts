import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, type TestContext } from 'node:test';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { setupAiClient, type AiClientLaunch, type AiClientSetupOptions } from '../clientSetup';

const SERVER = 'arduino_maker_workshop';
const args = ['C:\\Example User\\AI "Bridge"\\launcher.cjs', '--session-dir', 'C:\\Example User\\ai-bridge'];
const launch: AiClientLaunch = { command: path.resolve('VS Code', 'Code.exe'), args, env: { ELECTRON_RUN_AS_NODE: '1' } };

async function fixture(context: TestContext) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amw-client-setup-'));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const options: AiClientSetupOptions = { homeDirectory: root, environment: { PATH: '' } };
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

test('setup creates global client configuration without Node or client CLIs on PATH and is idempotent', async context => {
    const f = await fixture(context);
    for (const client of ['codex', 'claude'] as const) {
        const expectedPath = client === 'codex' ? f.codex : f.claude;
        assert.deepEqual(await setupAiClient(client, launch, f.options), { configPath: expectedPath, changed: true });
        const content = await fs.readFile(expectedPath, 'utf8');
        const config = client === 'codex' ? await codexConfig(expectedPath) : JSON.parse(content);
        const server = (client === 'codex' ? config.mcp_servers : config.mcpServers)[SERVER];
        assert.equal(server.command, launch.command);
        assert.deepEqual(server.args, args);
        assert.deepEqual(server.env, launch.env);
        if (client === 'codex') { assert.equal(server.tool_timeout_sec, 900); assert.equal(server.enabled, true); }
        else { assert.equal(server.type, 'stdio'); }
        assert.deepEqual(await setupAiClient(client, launch, f.options), { configPath: expectedPath, changed: false });
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
    await setupAiClient('codex', launch, f.options);
    const next = await fs.readFile(f.codex, 'utf8');
    const config = await codexConfig(f.codex);
    assert.ok(next.startsWith(original.slice(0, original.indexOf('[mcp_servers."arduino_maker_workshop"]'))));
    assert.ok(next.includes('approval_mode = "prompt" # keep user tool settings'));
    const server = config.mcp_servers[SERVER];
    assert.equal(server.enabled, true);
    assert.deepEqual(server.env, { KEEP: 'local-value', ...launch.env });
    assert.deepEqual(server.disabled_tools, ['compile_sketch']);
    assert.equal(server.tools.compile_sketch.approval_mode, 'prompt');
    assert.equal(server.url, undefined);
    assert.equal(server.http_headers, undefined);
    const saved = await backups(f.codex);
    assert.equal(saved.length, 1);
    assert.equal(await fs.readFile(path.join(path.dirname(f.codex), saved[0]), 'utf8'), original);
    if (process.platform !== 'win32') { assert.equal((await fs.stat(path.join(path.dirname(f.codex), saved[0]))).mode & 0o077, 0); }
    assert.equal((await setupAiClient('codex', launch, f.options)).changed, false);
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
        await setupAiClient('codex', launch, f.options);
        const config = await codexConfig(f.codex);
        assert.equal(config.mcp_servers[SERVER].command, launch.command);
        assert.deepEqual(config.mcp_servers[SERVER].args, args);
        assert.equal(config.mcp_servers[SERVER].tool_timeout_sec, 900);
        if (original.includes('KEEP')) { assert.deepEqual(config.mcp_servers[SERVER].env, { KEEP: 'value', ...launch.env }); }
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
    await setupAiClient('claude', launch, f.options);
    const config = JSON.parse(await fs.readFile(f.claude, 'utf8'));
    assert.deepEqual(config.projects, original.projects);
    assert.deepEqual(config.permissions, original.permissions);
    assert.deepEqual(config.mcpServers.other, original.mcpServers.other);
    assert.deepEqual(config.disabledMcpServers, ['other']);
    assert.deepEqual(config.mcpServers[SERVER], { type: 'stdio', env: { KEEP: 'value', ...launch.env }, disabled: false, customPermissions: ['read'], command: launch.command, args });
    assert.equal((await backups(f.claude)).length, 1);
});

test('Codex setup updates the runtime and required environment in every supported TOML form', async context => {
    const f = await fixture(context);
    const layouts = [
        '[mcp_servers.arduino_maker_workshop]\ncommand = "old-runtime"\nenv = { KEEP = "value", ELECTRON_RUN_AS_NODE = "0" } # keep environment comment\n',
        '[mcp_servers.arduino_maker_workshop]\ncommand = "old-runtime"\nenv.KEEP = "value" # keep environment comment\nenv.ELECTRON_RUN_AS_NODE = "0"\n',
        '[mcp_servers.arduino_maker_workshop]\ncommand = "old-runtime"\n[mcp_servers.arduino_maker_workshop.env]\nKEEP = "value" # keep environment comment\nELECTRON_RUN_AS_NODE = "0"\n',
        'mcp_servers.arduino_maker_workshop.command = "old-runtime"\nmcp_servers.arduino_maker_workshop.env.KEEP = "value" # keep environment comment\nmcp_servers.arduino_maker_workshop.env.ELECTRON_RUN_AS_NODE = "0"\n',
        '[mcp_servers]\narduino_maker_workshop.command = "old-runtime"\narduino_maker_workshop.env.KEEP = "value" # keep environment comment\n',
        'mcp_servers.arduino_maker_workshop = { command = "old-runtime", env = { KEEP = "value", ELECTRON_RUN_AS_NODE = "0" } } # keep environment comment\n',
        'mcp_servers = { arduino_maker_workshop = { command = "old-runtime", env.KEEP = "value", env.ELECTRON_RUN_AS_NODE = "0" } } # keep environment comment\n',
        'mcp_servers = { arduino_maker_workshop = { command = "old-runtime", env.KEEP = "value" } } # keep environment comment\n',
        'mcp_servers.arduino_maker_workshop.env = { KEEP = "value", ELECTRON_RUN_AS_NODE = "0" } # keep environment comment\n',
        '[mcp_servers.arduino_maker_workshop.env]\nKEEP = "value" # keep environment comment\n',
    ];
    for (const original of layouts) {
        await f.write(f.codex, original);
        assert.equal((await setupAiClient('codex', launch, f.options)).changed, true);
        const next = await fs.readFile(f.codex, 'utf8');
        const server = (await codexConfig(f.codex)).mcp_servers[SERVER];
        assert.equal(server.command, launch.command);
        assert.deepEqual(server.args, launch.args);
        assert.deepEqual(server.env, { KEEP: 'value', ELECTRON_RUN_AS_NODE: '1' });
        assert.ok(next.includes('# keep environment comment'));
        assert.equal((await setupAiClient('codex', launch, f.options)).changed, false);
        assert.equal(await fs.readFile(f.codex, 'utf8'), next);
    }
});

test('Claude setup updates only the required environment and runtime values', async context => {
    const f = await fixture(context);
    await f.write(f.claude, JSON.stringify({ mcpServers: { [SERVER]: {
        type: 'stdio', command: 'old-runtime', args: ['old-launcher'],
        env: { KEEP: 'value', ELECTRON_RUN_AS_NODE: '0' }, customPermissions: ['read'],
    } } }));
    await setupAiClient('claude', launch, f.options);
    const server = JSON.parse(await fs.readFile(f.claude, 'utf8')).mcpServers[SERVER];
    assert.deepEqual(server, { type: 'stdio', ...launch, env: { KEEP: 'value', ...launch.env }, customPermissions: ['read'] });
    assert.equal((await setupAiClient('claude', launch, f.options)).changed, false);
});

test('Codex setup supports empty environment subtables and dotted server entries in inline ancestors', async context => {
    const f = await fixture(context);
    const layouts = [
        '[mcp_servers.arduino_maker_workshop.env]',
        '[mcp_servers.arduino_maker_workshop.env]\n',
        '[mcp_servers.arduino_maker_workshop.env] # keep environment comment',
        'mcp_servers = { arduino_maker_workshop.env = { KEEP = "value" } }\n',
        'mcp_servers = { arduino_maker_workshop.env.KEEP = "value" }\n',
        'mcp_servers = { other = { command = "other" }, arduino_maker_workshop.env.KEEP = "value", arduino_maker_workshop.command = "old-runtime", arduino_maker_workshop.env.ELECTRON_RUN_AS_NODE = "0", arduino_maker_workshop.disabled_tools = ["compile_sketch"] } # keep environment comment\n',
        'mcp_servers = { "arduino_maker_workshop"."env"."KEEP" = "value", "arduino_maker_workshop"."env"."ELECTRON_RUN_AS_NODE" = "0" }\n',
    ];
    for (const original of layouts) {
        await f.write(f.codex, original);
        assert.equal((await setupAiClient('codex', launch, f.options)).changed, true);
        const next = await fs.readFile(f.codex, 'utf8');
        const config = await codexConfig(f.codex);
        const server = config.mcp_servers[SERVER];
        assert.equal(server.command, launch.command);
        assert.deepEqual(server.args, launch.args);
        assert.deepEqual(server.env, { ...(original.includes('KEEP') ? { KEEP: 'value' } : {}), ...launch.env });
        if (original.includes('other')) { assert.equal(config.mcp_servers.other.command, 'other'); }
        if (original.includes('disabled_tools')) { assert.deepEqual(server.disabled_tools, ['compile_sketch']); }
        if (original.includes('# keep environment comment')) { assert.ok(next.includes('# keep environment comment')); }
        assert.equal((await setupAiClient('codex', launch, f.options)).changed, false);
        assert.equal(await fs.readFile(f.codex, 'utf8'), next);
    }
});

test('setup rejects invalid existing environment values without changing either client configuration', async context => {
    const f = await fixture(context);
    const invalidConfigs: ['codex' | 'claude', string, string][] = [];
    for (const env of ['"not-an-environment"', '[]', '{ BAD = 1 }', '{ BAD = { NESTED = "value" } }', '{ "BAD=KEY" = "value" }']) {
        invalidConfigs.push(['codex', f.codex, `[mcp_servers.${SERVER}]\nenv = ${env}\n`]);
    }
    invalidConfigs.push(['codex', f.codex, `[mcp_servers.${SERVER}.env.BAD]\nNESTED = "value"\n`]);
    for (const env of [null, 'not-an-environment', [], { BAD: 1 }, { BAD: { NESTED: 'value' } }, { 'BAD=KEY': 'value' }, { BAD: '\0' }]) {
        invalidConfigs.push(['claude', f.claude, JSON.stringify({ mcpServers: { [SERVER]: { env } } })]);
    }
    for (const [client, file, original] of invalidConfigs) {
        await f.write(file, original);
        await assert.rejects(setupAiClient(client, launch, f.options), { code: 'INVALID_CLIENT_CONFIG' });
        assert.equal(await fs.readFile(file, 'utf8'), original);
        assert.deepEqual(await backups(file), []);
    }
});

test('setup requires an absolute runtime, launcher arguments and a valid environment before writing files', async context => {
    const f = await fixture(context);
    for (const invalid of [
        undefined, null, args, { ...launch, command: 'node' }, { ...launch, command: launch.command + '\0' },
        { ...launch, command: 1 }, { ...launch, args: [] }, { ...launch, args: ['bad\0argument'] },
        { ...launch, env: undefined }, { ...launch, env: null }, { ...launch, env: [] },
        { ...launch, env: { BAD: 1 } }, { ...launch, env: { '': 'value' } },
        { ...launch, env: { 'BAD=KEY': 'value' } }, { ...launch, env: { 'BAD\0KEY': 'value' } },
        { ...launch, env: { BAD: 'value\0' } },
    ]) {
        for (const client of ['codex', 'claude'] as const) {
            await assert.rejects(setupAiClient(client, invalid as AiClientLaunch, f.options), { code: 'INVALID_ARGUMENTS' });
        }
    }
    assert.deepEqual(await fs.readdir(f.root), []);
});

test('setup respects explicit client config directories and rejects relative overrides', async context => {
    const f = await fixture(context);
    const codexHome = path.join(f.root, 'codex-custom');
    const claudeHome = path.join(f.root, 'claude-custom');
    const options = { ...f.options, environment: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome } };
    assert.equal((await setupAiClient('codex', launch, options)).configPath, path.join(codexHome, 'config.toml'));
    assert.equal((await setupAiClient('claude', launch, options)).configPath, path.join(claudeHome, '.claude.json'));
    await assert.rejects(setupAiClient('codex', launch, { ...f.options, environment: { CODEX_HOME: 'relative' } }), { code: 'INVALID_ARGUMENTS' });
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
        await assert.rejects(setupAiClient(client, launch, f.options), { code: 'INVALID_CLIENT_CONFIG' });
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
        await assert.rejects(setupAiClient('codex', launch, {
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
    const first = setupAiClient('claude', launch, { ...f.options, beforeCommit: async () => { entered(); await held; } });
    await started;
    try { await assert.rejects(setupAiClient('claude', { ...launch, args: ['other-launcher'] }, f.options), { code: 'CLIENT_SETUP_BUSY' }); }
    finally { release(); }
    await first;
    const config = JSON.parse(await fs.readFile(f.claude, 'utf8'));
    assert.deepEqual(config.mcpServers[SERVER].args, args);
    assert.equal((await fs.readdir(f.root)).some(name => name.endsWith('.amw-setup.lock') || name.endsWith('.tmp')), false);
});
