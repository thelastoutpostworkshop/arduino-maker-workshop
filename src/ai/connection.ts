import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AiIntegrationState, AiSetupClient } from '../shared/messages';
import { setupAiClient, type AiClientLaunch } from './clientSetup';
import { AiBridgeError, AiToolHandler } from './contracts';
import { createAiIpcServer } from './ipcServer';

const providerId = 'arduinoMakerWorkshop.aiBridge';

export interface AiConnectionOptions {
    handler: AiToolHandler;
    ready(): boolean;
    activeSketchPath(): string | undefined;
    onStateChanged?(state: AiIntegrationState): void;
}

export interface AiConnectionController extends vscode.Disposable {
    refresh(): Promise<void>;
    getState(): AiIntegrationState;
}

/** Remembered opt-in controls ephemeral, trusted-window sessions; credentials never persist. */
export function registerAiConnection(context: vscode.ExtensionContext, options: AiConnectionOptions): AiConnectionController {
    let session: Awaited<ReturnType<typeof createAiIpcServer>> | undefined;
    let sessionSketch: string | undefined;
    let generation = 0;
    let disposed = false;
    let nativeMcpAvailable = false;
    let setupBusy = false;
    let disabledLocally = false;
    let pendingPreference: { enabled: boolean; id: number } | undefined;
    let preferenceId = 0;
    let preferenceWrites = Promise.resolve();
    const directory = path.join(context.globalStorageUri.fsPath, 'ai-bridge');
    const launcherPath = path.join(directory, 'launcher.cjs');
    // Use the extension host's bundled runtime for every client; no Node executable
    // needs to be installed or discoverable on the external client's PATH.
    const launcherDefinition = (): AiClientLaunch => ({
        command: process.execPath,
        args: [launcherPath, '--session-dir', directory],
        env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    const changes = new vscode.EventEmitter<void>();
    const subscriptions: vscode.Disposable[] = [changes];
    const readyMessage = 'AI integration is ready. AI operations run without extension approval prompts.';
    let state: AiIntegrationState = { enabled: false, status: 'disabled', message: 'AI integration is disabled.', nativeMcpAvailable };
    const getState = () => ({ ...state });
    const publish = (next: Omit<AiIntegrationState, 'nativeMcpAvailable'>) => {
        if (disposed) { return; }
        state = { ...next, nativeMcpAvailable, busy: setupBusy || next.status === 'connecting' };
        options.onStateChanged?.(getState());
    };
    const configuredEnabled = () => !disabledLocally && (pendingPreference?.enabled ??
        vscode.workspace.getConfiguration('arduinoMakerWorkshop').inspect<boolean>('ai.enabled')?.globalValue === true);
    const target = () => {
        const enabled = !disposed && configuredEnabled();
        if (!enabled) { return { enabled, status: 'disabled' as const, message: 'AI integration is disabled.', sketchPath: undefined }; }
        let message: string | undefined;
        const sketchPath = options.activeSketchPath();
        if (!vscode.workspace.isTrusted) {
            message = 'Trust this workspace in VS Code to connect AI assistants.';
        } else if (vscode.env.remoteName) {
            message = 'AI integration requires a local VS Code window. Remote hosts are not supported.';
        } else if (!sketchPath || !path.isAbsolute(sketchPath) || !['.ino', '.pde'].some(extension => {
            try { return fs.statSync(path.join(sketchPath, path.basename(sketchPath) + extension)).isFile(); }
            catch { return false; }
        })) {
            message = 'Open a local Arduino sketch folder containing its matching .ino or .pde file.';
        } else if (!options.ready()) {
            message = 'Waiting for Arduino CLI setup. Open Arduino Home to finish setup.';
        }
        return { enabled, status: 'waiting' as const, message: message ?? 'Connecting AI assistants...', sketchPath: message ? undefined : sketchPath };
    };
    let desired = target();
    let desiredKey = JSON.stringify(desired);
    let closing = Promise.resolve();
    const revoke = () => {
        const previous = session;
        session = undefined;
        sessionSketch = undefined;
        changes.fire();
        if (previous) {
            // dispose() closes sockets immediately; await cleanup before opening the replacement.
            const cleanup = previous.dispose();
            closing = Promise.allSettled([closing, cleanup]).then(() => {});
        }
    };
    let worker: Promise<void> | undefined;
    let dirty = false;
    let failedGeneration: number | undefined;
    const stillCurrent = (revision: number, sketchPath: string) => !disposed && revision === generation && target().sketchPath === sketchPath;
    const reconcile = async () => {
        while (dirty && !disposed) {
            dirty = false;
            const current = desired;
            const revision = generation;
            try {
                await closing;
                if (disposed || revision !== generation) { continue; }
                if (!current.sketchPath) { publish(current); continue; }
                if (session && sessionSketch === current.sketchPath) {
                    publish({ enabled: true, status: 'ready', message: readyMessage });
                    continue;
                }
                if (failedGeneration === revision) { continue; }
                publish({ enabled: true, status: 'connecting', message: 'Connecting AI assistants...' });
                fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
                const temporaryLauncher = path.join(directory, `launcher-${process.pid}-${Date.now()}-${revision}.tmp`);
                try {
                    fs.copyFileSync(path.join(context.extensionPath, 'build', 'aiBridge.cjs'), temporaryLauncher);
                    fs.renameSync(temporaryLauncher, launcherPath);
                } finally {
                    fs.rmSync(temporaryLauncher, { force: true });
                }
                const created = await createAiIpcServer({
                    sessionDirectory: directory, sketchPath: current.sketchPath, handler: options.handler,
                    isTrusted: () => stillCurrent(revision, current.sketchPath!),
                });
                if (!stillCurrent(revision, current.sketchPath)) {
                    await created.dispose();
                    void refresh();
                    continue;
                }
                session = created;
                sessionSketch = current.sketchPath;
                changes.fire();
                publish({ enabled: true, status: 'ready', message: readyMessage });
            } catch (error) {
                if (!disposed && revision === generation) {
                    failedGeneration = revision;
                    publish({ enabled: current.enabled, status: 'error', message: error instanceof AiBridgeError ? error.message : 'Could not start the AI bridge. Rebuild or reinstall the extension package and retry.' });
                }
            }
        }
    };
    const refresh = (): Promise<void> => {
        if (disposed) { return Promise.resolve(); }
        desired = target();
        const key = JSON.stringify(desired);
        if (key !== desiredKey) {
            desiredKey = key;
            generation++;
            failedGeneration = undefined;
        }
        if (session && sessionSketch !== desired.sketchPath) { revoke(); }
        if (!desired.sketchPath) { publish(desired); }
        dirty = true;
        if (!worker) {
            failedGeneration = undefined;
            worker = Promise.resolve().then(reconcile).finally(() => {
                worker = undefined;
                if (dirty && !disposed) { return refresh(); }
            });
        }
        return worker;
    };

    // The 1.93 baseline remains usable. MCP registration is an optional newer API.
    const api = vscode as typeof vscode & {
        lm?: { registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable };
        McpStdioServerDefinition?: new (label: string, command: string, args: string[], env: Record<string, string>, version: string) => unknown;
    };
    if (typeof api.lm?.registerMcpServerDefinitionProvider === 'function' && typeof api.McpStdioServerDefinition === 'function') {
        try {
            subscriptions.push(api.lm.registerMcpServerDefinitionProvider(providerId, {
            onDidChangeMcpServerDefinitions: changes.event,
            provideMcpServerDefinitions: () => {
                if (!session || target().sketchPath !== sessionSketch) { return []; }
                const launch = launcherDefinition();
                return [new api.McpStdioServerDefinition!(
                    'Arduino Maker Workshop', launch.command, launch.args, launch.env,
                    context.extension.packageJSON.version
                )];
            },
            resolveMcpServerDefinition: (definition: unknown) => session && target().sketchPath === sessionSketch ? definition : undefined,
            }));
            nativeMcpAvailable = true;
        } catch {
            // Some older hosts expose proposed API symbols but reject registration.
            // External clients and the setup guide remain available on those hosts.
        }
    }

    const showSetup = async () => {
        const sketchPath = options.activeSketchPath();
        const launch = launcherDefinition();
        const environment = Object.entries(launch.env).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(', ');
        const codex = `[mcp_servers.arduino_maker_workshop]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}\nenv = { ${environment} }\ntool_timeout_sec = 900\n`;
        const claude = JSON.stringify({ mcpServers: { arduino_maker_workshop: { type: 'stdio', ...launch } } }, null, 2);
        const copilot = JSON.stringify({ servers: { arduino_maker_workshop: { type: 'stdio', ...launch } } }, null, 2);
        const markdown = [
            '# Arduino Maker Workshop - AI connection',
            '',
            'Sketch selected in this window (access requires AI Integration to be enabled and ready):',
            '', '```text', sketchPath ?? 'No local sketch selected', '```',
            '',
            'Enable AI Integration once on the AI Integration page in Arduino Maker Workshop. This computer remembers your choice and automatically connects trusted local sketch windows after Arduino CLI is ready. Disable AI Integration to revoke access and stop future automatic connections.',
            '',
            'AI operations run without extension approval prompts in trusted local workspaces. Compilation runs installed board-package recipes, writes build files, and may download dependencies. Your AI client controls its own tool permissions.',
            '',
            'Set up each AI client once using the buttons on the AI Integration page, or run Arduino Maker Workshop: Set Up AI Client from the Command Palette. The Codex and Claude Code buttons update only the Arduino Maker Workshop entry in your user configuration. Copilot uses the extension\'s native MCP registration on supported VS Code versions.',
            '',
            '| Client | Setup method |',
            '| --- | --- |',
            '| Codex desktop / IDE / CLI | Set up Codex, then restart its MCP server or session |',
            '| Claude Code | Set up Claude Code, then start a new conversation |',
            '| Copilot / VS Code | Use with Copilot, then select/start Arduino Maker Workshop |',
            '',
            'Remembered enablement makes sketches available; client setup tells an assistant how to reach them. The same client entry works with every connected sketch in this computer and VS Code storage profile. Your session tokens are still temporary and never go into client configuration.',
            '',
            'The sections below are manual alternatives. Their configuration blocks already contain your computer\'s paths. Copy only the matching code block contents, without Markdown fence lines. Keep the generated quotes and doubled Windows backslashes when editing files, and preserve unrelated settings and servers. Do not complete both automatic and manual setup.',
            '',
            'Opening this guide does not edit client settings. Reopen it with Arduino Maker Workshop: AI Setup Instructions. Keep these local settings out of version control; they contain local paths but no authentication tokens.',
            '',
            'No separate Node.js installation is needed. The generated command uses the runtime included with this VS Code installation. Keep the supplied command, args, and env values together; ELECTRON_RUN_AS_NODE=1 lets the runtime run the AI connection without opening another VS Code window.',
            '',
            '## Manual Codex setup - paste TOML',
            '',
            'Use this block for the desktop app, IDE extension, or CLI; they share the same configuration. Codex uses TOML for this setup.',
            '',
            '1. Open your user configuration file in an editor. The default location is ~/.codex/config.toml on macOS/Linux or %USERPROFILE%\\.codex\\config.toml on Windows. Create the file if needed.',
            '   If CODEX_HOME is set, use config.toml inside that folder. Automatic setup also respects this override.',
            '2. Paste the block below. If [mcp_servers.arduino_maker_workshop] already exists, update its command, args, env, and tool_timeout_sec values instead of adding a second table with the same name. Merge ELECTRON_RUN_AS_NODE into any existing env settings, keeping unrelated variables.',
            '', '```toml', codex, '```',
            '',
            '3. Save the file. In the desktop app, open Settings > MCP servers and restart Arduino Maker Workshop. Restart the IDE extension or CLI session if using those clients.',
            '',
            'The block already includes tool_timeout_sec = 900 to allow time for compilation. It is a separate configuration setting, not an argument. Do not paste this TOML block into an Arguments field.',
            '',
            '[Official OpenAI MCP setup instructions](https://learn.chatgpt.com/docs/extend/mcp#connect-an-existing-mcp-server)',
            '',
            '## Manual Claude Code setup - paste JSON',
            '',
            '1. Close Claude Code, then open its user configuration file in an editor. The default location is ~/.claude.json on macOS/Linux or %USERPROFILE%\\.claude.json on Windows.',
            '   If CLAUDE_CONFIG_DIR is set, use .claude.json inside that folder. Automatic setup also respects this override.',
            '2. For an empty file, paste the entire JSON block below. For an existing file, add or update only arduino_maker_workshop inside the top-level mcpServers object. Keep other settings and servers. Do not append a second JSON document or duplicate the mcpServers key.',
            '', '```json', claude, '```',
            '',
            '3. Save the file and restart Claude Code. Use /mcp to check the connection. User configuration applies across projects.',
            '',
            '[Official Claude Code MCP setup instructions](https://code.claude.com/docs/en/mcp#user-scope)',
            '',
            '## Copilot / VS Code',
            '',
            'On supported versions, enable AI Integration and select Arduino Maker Workshop in the MCP tools picker. The extension registers it automatically; no configuration needs to be pasted. VS Code controls actual server startup and its own tool permissions.',
            '',
            'For manual setup, use the Command Palette command MCP: Open User Configuration to open your profile\'s mcp.json. In an empty file, paste the full block below. Otherwise add or update only arduino_maker_workshop inside the existing servers object, keeping other settings. Save, then start or restart the server using MCP: List Servers.',
            '', '```json', copilot, '```',
            '', 'This VS Code file uses servers; the Claude Code block uses mcpServers. Use the block for your client.',
            '', '[Official VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)',
            '', '## Alternative: enter Codex desktop fields individually',
            '', 'Use this only if you prefer the app form instead of pasting TOML. You do not need to complete both methods.',
            '', 'In Settings > MCP servers, add a server or edit the existing Arduino Maker Workshop entry:',
            '', '- Name: arduino_maker_workshop',
            '- Transport: STDIO (local command)',
            '', 'Command (copy this full path without surrounding quotes):',
            '', '```text', launch.command, '```',
            '', 'Environment variable: set ELECTRON_RUN_AS_NODE to 1. If the form does not offer environment variables, use the complete TOML block above instead.',
            '', 'Add the following three arguments separately, in order. Copy these raw values without quotes, commas, brackets, or args =. A path containing spaces is still one argument. Windows paths in these fields use single backslashes.',
            '',
            ...launch.args.flatMap((argument, index) => [`Argument ${index + 1}:`, '', '```text', argument, '```', '']),
            'Save and restart the server. Set tool_timeout_sec = 900 separately in its config.toml table as shown in the Codex section; it is not a fourth argument.',
            '', '## Check the connection',
            '', 'Ask the assistant: "List my connected sketches, then inspect the sketch I choose and report its selected board or profile." Once that works, ask it to compile. Compilation starts without an extension approval prompt.',
            '', '## Next time you open a sketch',
            '', 'Leave AI Integration enabled. A trusted local sketch window reconnects automatically after Arduino CLI is ready, including after a reload or restart. Your saved client settings remain valid; the next tool call finds the new session. An interrupted compile must be requested again.',
            '', 'Disable AI Integration on the AI Integration page to disconnect enabled windows and stop automatic reconnection for this VS Code user profile on this computer. Closing a window still destroys its temporary session and credentials. No upload or serial tools are available.',
            '', '## Using another sketch or computer',
            '', 'For another sketch, open its trusted local VS Code window and keep the same saved server entry. Multiple different sketches may be connected at once. Run setup again if you move to another computer or VS Code storage profile, or move or reinstall VS Code at a different location. Do not distribute this document as a configuration for other users.',
            '', 'If several sketches are listed, choose the intended sketch instead of guessing. If a sketch has sessionCount greater than one, close its extra window before requesting project operations. The native VS Code provider uses the same global tools and is advertised in this window only while its session is ready.',
        ].join('\n');
        const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
        await vscode.window.showTextDocument(document, { preview: false });
    };

    const setEnabled = async (enabled: boolean) => {
        if (disposed) { return getState(); }
        const preference = { enabled, id: ++preferenceId };
        pendingPreference = preference;
        if (enabled) { disabledLocally = false; }
        // Revoke immediately, even if a preceding settings write or session creation is pending.
        if (!enabled) { void refresh(); }
        const write = preferenceWrites.then(async () => {
            if (!disposed) {
                await vscode.workspace.getConfiguration('arduinoMakerWorkshop').update('ai.enabled', enabled, vscode.ConfigurationTarget.Global);
            }
        });
        preferenceWrites = write.catch(() => {});
        let failure: AiBridgeError | undefined;
        try {
            await write;
        } catch {
            if (!enabled && pendingPreference === preference) { disabledLocally = true; }
            failure = new AiBridgeError('SETTINGS_UPDATE_FAILED', enabled
                ? 'Could not save AI Integration settings. Check that your VS Code user settings are writable and retry.'
                : 'AI integration is disconnected in this window, but its Disabled setting could not be saved. Other windows may remain enabled. Set arduinoMakerWorkshop.ai.enabled to false in VS Code user settings.');
            throw failure;
        } finally {
            if (pendingPreference === preference) { pendingPreference = undefined; }
            await refresh();
            if (failure) { publish({ ...state, message: failure.message }); }
        }
        return getState();
    };
    const requireReady = () => {
        const current = target();
        if (disposed || !session || !current.sketchPath || current.sketchPath !== sessionSketch) {
            throw new AiBridgeError('BRIDGE_DISABLED', current.enabled ? current.message : 'Enable AI Integration on the AI Integration page before setting up a client.');
        }
    };
    const setupClient = async (requestedClient?: AiSetupClient) => {
        if (setupBusy) { return getState(); }
        let client = requestedClient;
        if (client === undefined) {
            const choice = await vscode.window.showQuickPick([
                { label: 'Codex', description: 'Update your user config.toml', client: 'codex' as const },
                { label: 'Claude Code', description: 'Update your user .claude.json', client: 'claude' as const },
                { label: 'Copilot / VS Code', description: 'Use the automatically registered MCP server', client: 'copilot' as const },
            ], { title: 'Set Up AI Client', placeHolder: 'Choose the client to configure on this computer' });
            client = choice?.client;
            if (!client || setupBusy) { return getState(); }
        }
        if (!['codex', 'claude', 'copilot'].includes(client)) {
            throw new AiBridgeError('INVALID_ARGUMENTS', 'Choose Codex, Claude Code, or Copilot.');
        }
        await refresh();
        requireReady();
        if (setupBusy) { return getState(); }
        setupBusy = true;
        publish({ ...state, message: 'Setting up the selected AI client...' });
        try {
            if (client === 'copilot') {
                if (nativeMcpAvailable) {
                    try { await vscode.commands.executeCommand('workbench.mcp.listServer'); }
                    catch { await showSetup(); }
                    if (!disposed) {
                        publish({ ...state, message: 'Select Arduino Maker Workshop in the MCP server list, start it if needed, and enable its tools in Copilot.' });
                    }
                } else {
                    await showSetup();
                    publish({ ...state, message: 'This VS Code version has no native MCP provider. Use the manual Copilot instructions or update VS Code.' });
                }
            } else {
                const result = await setupAiClient(client, launcherDefinition());
                const message = `${client === 'codex' ? 'Codex' : 'Claude Code'} configuration ${result.changed ? 'updated' : 'already configured'} at ${result.configPath}. ${client === 'codex' ? 'Restart the MCP server or Codex session.' : 'Start a new Claude Code conversation.'} Ask it to list connected Arduino sketches first.`;
                if (!disposed) {
                    publish({ ...state, message });
                    void vscode.window.showInformationMessage(message);
                }
            }
        } catch (error) {
            const failure = error instanceof AiBridgeError ? error : new AiBridgeError('CLIENT_SETUP_FAILED', 'Could not configure the AI client. Use Manual setup instructions to check its configuration.');
            publish({ ...state, message: failure.message });
            throw failure;
        } finally {
            setupBusy = false;
            publish(state);
        }
        return getState();
    };
    const register = (name: string, action: (...args: any[]) => unknown) => subscriptions.push(vscode.commands.registerCommand(`arduinoMakerWorkshop.${name}`, action));
    register('getAiIntegrationState', getState);
    register('enableAiIntegration', () => setEnabled(true));
    register('disableAiIntegration', () => setEnabled(false));
    register('setupAiClient', setupClient);
    register('showAiSetup', async () => { await showSetup(); return getState(); });
    subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('arduinoMakerWorkshop.ai.enabled')) {
            if (!pendingPreference) { disabledLocally = false; }
            void refresh();
        }
    }));
    subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void refresh(); }));
    subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void refresh(); }));
    const controller = Object.assign(new vscode.Disposable(() => {
        disposed = true;
        generation++;
        revoke();
        subscriptions.forEach(subscription => subscription.dispose());
    }), { refresh, getState });
    void refresh();
    return controller;
}
