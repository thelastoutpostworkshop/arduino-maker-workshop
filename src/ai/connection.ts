import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AiBridgeError, AiToolHandler } from './contracts';
import { createAiIpcServer } from './ipcServer';

const providerId = 'arduinoMakerWorkshop.aiBridge';

export interface AiConnectionOptions {
    handler: AiToolHandler;
    ready(): boolean;
    activeSketchPath(): string | undefined;
}

/** No listener, descriptor, or credential exists until the user invokes Connect. */
export function registerAiConnection(context: vscode.ExtensionContext, options: AiConnectionOptions): vscode.Disposable {
    let session: Awaited<ReturnType<typeof createAiIpcServer>> | undefined;
    let connecting = false;
    let generation = 0;
    let disposed = false;
    let launcherPath = '';
    const launcherArguments = () => [launcherPath, '--session-dir', path.dirname(launcherPath)];
    const changes = new vscode.EventEmitter<void>();
    const subscriptions: vscode.Disposable[] = [changes];
    const disconnect = async () => {
        generation++;
        const previous = session;
        session = undefined;
        changes.fire();
        await previous?.dispose();
    };

    // The 1.93 baseline remains usable. MCP registration is an optional newer API.
    const api = vscode as typeof vscode & {
        lm?: { registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable };
        McpStdioServerDefinition?: new (label: string, command: string, args: string[], env: Record<string, string>, version: string) => unknown;
    };
    if (typeof api.lm?.registerMcpServerDefinitionProvider === 'function' && typeof api.McpStdioServerDefinition === 'function') {
        subscriptions.push(api.lm.registerMcpServerDefinitionProvider(providerId, {
            onDidChangeMcpServerDefinitions: changes.event,
            provideMcpServerDefinitions: () => session ? [new api.McpStdioServerDefinition!(
                'Arduino Maker Workshop',
                process.execPath,
                launcherArguments(),
                { ELECTRON_RUN_AS_NODE: '1' },
                context.extension.packageJSON.version
            )] : [],
            resolveMcpServerDefinition: (definition: unknown) => session && vscode.workspace.isTrusted ? definition : undefined,
        }));
    }

    const showSetup = async () => {
        const sketchPath = options.activeSketchPath();
        if (!session || !sketchPath) {
            throw new AiBridgeError('BRIDGE_DISABLED', 'Connect an AI assistant from the selected VS Code window first.');
        }
        const args = launcherArguments();
        const codex = `[mcp_servers.arduino_maker_workshop]\ncommand = "node"\nargs = ${JSON.stringify(args)}\ntool_timeout_sec = 900\n`;
        const claude = JSON.stringify({ mcpServers: { arduino_maker_workshop: { type: 'stdio', command: 'node', args } } }, null, 2);
        const copilot = JSON.stringify({ servers: { arduino_maker_workshop: { type: 'stdio', command: 'node', args } } }, null, 2);
        const markdown = [
            '# Arduino Maker Workshop - AI connection',
            '',
            'Sketch enabled by this window:',
            '', '```text', sketchPath, '```',
            '',
            'Configure one Arduino Maker Workshop server for this computer and VS Code storage profile. The same entry works with any sketch you explicitly connect. The configuration blocks already contain the paths for your computer.',
            '',
            'Choose your client below. For manual setup, copy its configuration block and paste it into the file named in that section. You do not need to enter arguments individually when using a configuration file. The formats differ by client:',
            '',
            '| Client | Setup method |',
            '| --- | --- |',
            '| Codex desktop / IDE / CLI | TOML in ~/.codex/config.toml |',
            '| Claude Code | JSON in ~/.claude.json, under mcpServers |',
            '| Copilot / VS Code | Select the automatically registered server; JSON in user mcp.json if manual setup is needed |',
            '',
            'Copy only the contents of the matching code block, without the Markdown fence lines. Keep the generated quotes and doubled Windows backslashes when editing configuration files. Preserve other settings and servers already in those files.',
            '',
            'This command has not edited your AI client\'s settings. To reopen this guide, run Connect AI Assistant again while connected. Keep these local settings out of version control; they contain local paths but no authentication tokens.',
            '',
            'External clients need Node.js 20 or newer on this same computer. If the client cannot find node, set command to the full path of your Node executable using the file format\'s quoting rules.',
            '',
            '## Codex - paste TOML',
            '',
            'Use this block for the desktop app, IDE extension, or CLI; they share the same configuration. Codex uses TOML for this setup.',
            '',
            '1. Open your user configuration file in an editor. The default location is ~/.codex/config.toml on macOS/Linux or %USERPROFILE%\\.codex\\config.toml on Windows. Create the file if needed.',
            '2. Paste the block below. If [mcp_servers.arduino_maker_workshop] already exists, update its command, args, and tool_timeout_sec values instead of adding a second table with the same name.',
            '', '```toml', codex, '```',
            '',
            '3. Save the file. In the desktop app, open Settings > MCP servers and restart Arduino Maker Workshop. Restart the IDE extension or CLI session if using those clients.',
            '',
            'The block already includes tool_timeout_sec = 900 to allow time for approval and compilation. It is a separate configuration setting, not an argument. Do not paste this TOML block into an Arguments field.',
            '',
            '[Official OpenAI MCP setup instructions](https://learn.chatgpt.com/docs/extend/mcp#connect-an-existing-mcp-server)',
            '',
            '## Claude Code - paste JSON',
            '',
            '1. Close Claude Code, then open its user configuration file in an editor. The default location is ~/.claude.json on macOS/Linux or %USERPROFILE%\\.claude.json on Windows.',
            '2. For an empty file, paste the entire JSON block below. For an existing file, add or update only arduino_maker_workshop inside the top-level mcpServers object. Keep other settings and servers. Do not append a second JSON document or duplicate the mcpServers key.',
            '', '```json', claude, '```',
            '',
            '3. Save the file and restart Claude Code. Use /mcp to check the connection. User configuration applies across projects.',
            '',
            '[Official Claude Code MCP setup instructions](https://code.claude.com/docs/en/mcp#user-scope)',
            '',
            '## Copilot / VS Code',
            '',
            'On supported versions, select Arduino Maker Workshop in the MCP tools picker after running Connect. The extension registers it automatically; no configuration needs to be pasted.',
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
            '- Command: node',
            '', 'Add the following three arguments separately, in order. Copy these raw values without quotes, commas, brackets, or args =. A path containing spaces is still one argument. Windows paths in these fields use single backslashes.',
            '',
            ...args.flatMap((argument, index) => [`Argument ${index + 1}:`, '', '```text', argument, '```', '']),
            'Save and restart the server. Set tool_timeout_sec = 900 separately in its config.toml table as shown in the Codex section; it is not a fourth argument.',
            '', '## Check the connection',
            '', 'Ask the assistant: "List connected Arduino Maker Workshop sketches, then inspect the sketch I choose and report its selected board or profile." Once that works, ask it to compile and approve the request in VS Code.',
            '', '## Updating an existing AI connection',
            '', 'If your saved entry uses --sketch or --session, update that entry using the matching configuration block above, then restart its MCP server once. The new args contain only the launcher path, --session-dir, and the bridge storage folder. Future sketch changes reuse this entry.',
            '', '## Next time you open a sketch',
            '', 'Run Connect AI Assistant in VS Code again and approve the connection. Your saved client settings remain valid; its next tool call reconnects. No argument edits are needed after a reload or debug restart. An interrupted compile must be requested again.',
            '', 'This connection is enabled only until Disconnect, reload, or close. Each compile asks for approval here. No upload or serial tools are available.',
            '', '## Using another sketch or computer',
            '', 'For another sketch, run Connect from its VS Code window and keep the same saved server entry. Multiple different sketches may be connected at once. The assistant lists connected sketches and sends the chosen sketchPath with each project operation. Only moving to another computer or VS Code storage profile requires new setup paths. Do not distribute this document as a configuration for other users.',
            '', 'If several sketches are listed, choose the intended sketch instead of guessing. If a sketch has sessionCount greater than one, disconnect its extra window sessions before requesting project operations. The native VS Code provider uses the same global tools and is advertised in this window only while its session is enabled.',
            '', '## Extension developers',
            '', 'When testing changes to the extension, restart Run and Debug, then run Connect AI Assistant in the Extension Development Host. If the standalone bridge code changed, also restart the client\'s MCP server to load the rebuilt launcher. Its arguments stay the same.',
        ].join('\n');
        const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
        await vscode.window.showTextDocument(document, { preview: false });
    };

    subscriptions.push(vscode.commands.registerCommand('arduinoMakerWorkshop.connectAiAssistant', async () => {
        if (connecting) {
            return;
        }
        connecting = true;
        const connectionGeneration = generation;
        try {
            if (!vscode.workspace.isTrusted) {
                throw new AiBridgeError('WORKSPACE_UNTRUSTED', 'Trust this workspace in VS Code before connecting an assistant.');
            }
            const sketchPath = options.activeSketchPath();
            if (!sketchPath || vscode.env.remoteName) {
                throw new AiBridgeError('UNSUPPORTED_HOST', 'Select a local sketch folder in a local VS Code window. Remote hosts are not supported in this first slice.');
            }
            if (!options.ready()) {
                throw new AiBridgeError('CLI_NOT_READY', 'Resolve Arduino CLI setup in Arduino Home before connecting an assistant.');
            }
            if (session) {
                await showSetup();
                return;
            }
            const choice = await vscode.window.showWarningMessage(
                `Connect AI assistants to ${path.basename(sketchPath)} in this window?`,
                { modal: true, detail: 'Grants project context and board/port discovery for this session. Every compile requires separate approval because board-package recipes execute code and may download dependencies. Closing, reloading, or Disconnect revokes access. No upload or serial tools are exposed.' },
                'Connect This Session'
            );
            if (choice !== 'Connect This Session' || disposed || connectionGeneration !== generation || !vscode.workspace.isTrusted || options.activeSketchPath() !== sketchPath) {
                return;
            }
            const directory = path.join(context.globalStorageUri.fsPath, 'ai-bridge');
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            launcherPath = path.join(directory, 'launcher.cjs');
            const source = path.join(context.extensionPath, 'build', 'aiBridge.cjs');
            const temporaryLauncher = path.join(directory, `launcher-${process.pid}-${Date.now()}.tmp`);
            fs.copyFileSync(source, temporaryLauncher);
            fs.renameSync(temporaryLauncher, launcherPath);
            const created = await createAiIpcServer({
                sessionDirectory: directory,
                sketchPath,
                handler: options.handler,
                isTrusted: () => vscode.workspace.isTrusted,
            });
            if (disposed || connectionGeneration !== generation || !vscode.workspace.isTrusted || options.activeSketchPath() !== sketchPath) {
                await created.dispose();
                return;
            }
            session = created;
            changes.fire();
            await showSetup();
        } catch (error) {
            await vscode.window.showErrorMessage(error instanceof AiBridgeError ? error.message : 'Could not start the AI bridge. Rebuild or reinstall the extension package and retry.');
        } finally {
            connecting = false;
        }
    }));
    subscriptions.push(vscode.commands.registerCommand('arduinoMakerWorkshop.disconnectAiAssistant', async () => {
        await disconnect();
        await vscode.window.showInformationMessage('Arduino Maker Workshop AI session disconnected.');
    }));
    subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void disconnect(); }));
    return new vscode.Disposable(() => {
        disposed = true;
        void disconnect();
        subscriptions.forEach((subscription) => subscription.dispose());
    });
}
