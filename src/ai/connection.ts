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
            'These settings were generated for your computer and VS Code storage profile. Every user gets their own paths by running Connect AI Assistant in their VS Code window. You do not need to find or type these paths yourself.',
            '',
            'Configure one Arduino Maker Workshop server for this computer and VS Code storage profile. The same entry works with any sketch you explicitly connect here. Choose your client below. To reopen this guide, run Connect AI Assistant again while connected.',
            '',
            'External clients need Node.js 20 or newer on this same computer. If the client cannot find node, use the full path to your Node executable in its Command field.',
            '',
            '## Codex desktop app',
            '',
            '1. In the app, open Settings > MCP servers > Add server. If you already added Arduino Maker Workshop, edit that existing entry.',
            '2. Enter the following values:',
            '',
            '- Name: arduino_maker_workshop',
            '- Transport: STDIO (local command)',
            '- Command: node',
            '',
            'Arguments: add each value below as a separate argument, in order. Copy the text exactly, without surrounding quotes, commas, brackets, or args =. Windows paths here use single backslashes.',
            '',
            ...args.flatMap((argument, index) => [`Argument ${index + 1}:`, '', '```text', argument, '```', '']),
            '3. Save the server, then select Restart. When migrating an older entry using --sketch or --session, replace all its old arguments with the three above.',
            '4. Ask the assistant: "List connected Arduino Maker Workshop sketches, then inspect the sketch I choose and report its selected board or profile." Every project operation must include that sketch\'s explicit path. Once that works, ask it to compile and approve the request in VS Code.',
            '',
            'For compilation, set tool_timeout_sec = 900 in this server\'s config.toml section, as shown below. This is a separate setting, not an argument.',
            '',
            '### Alternative: Codex configuration file / IDE / CLI',
            '',
            'If you prefer editing configuration, merge the block below into ~/.codex/config.toml on this computer (on Windows, the .codex folder inside your user folder). The desktop app, IDE extension, and CLI share that configuration. Update an existing arduino_maker_workshop section instead of adding a duplicate. You only need one setup method.',
            '', '```toml', codex, '```',
            '',
            'The doubled Windows backslashes in this TOML block are required for file syntax. Use the plain values above when filling in the app\'s Arguments fields.',
            '',
            '[Official OpenAI MCP setup instructions](https://learn.chatgpt.com/docs/extend/mcp#connect-an-existing-mcp-server)',
            '',
            '## Copilot / VS Code',
            '',
            'On VS Code versions supporting extension MCP providers, this enabled connection is advertised automatically. Select the Arduino Maker Workshop server in the MCP tools picker; no paths need to be entered. Otherwise, if your version supports manual MCP configuration, merge this into your user/profile MCP configuration:',
            '', '```json', copilot, '```',
            '', '## Claude Code',
            '', 'Use Claude Code\'s MCP setup or manually merge this into your chosen local/project MCP configuration:',
            '', '```json', claude, '```',
            '', '## Next time you open a sketch',
            '', 'Run Connect AI Assistant in VS Code again and approve the connection. Your saved client settings remain valid; its next tool call reconnects. No argument edits are needed after a reload or debug restart. An interrupted compile must be requested again.',
            '', 'This connection is enabled only until Disconnect, reload, or close. Each compile asks for approval here. No upload or serial tools are available.',
            '', '## Using another sketch or computer',
            '', 'For another sketch, run Connect from its VS Code window and keep the same saved server entry. Multiple different sketches may be connected at once. The assistant lists connected sketches and sends the chosen sketchPath with each project operation. Only moving to another computer or VS Code storage profile requires new setup paths. Do not distribute this document as a configuration for other users.',
            '', 'If several sketches are listed, choose the intended sketch instead of guessing. If a sketch has sessionCount greater than one, disconnect its extra window sessions before requesting project operations. The native VS Code provider uses the same global tools and is advertised in this window only while its session is enabled.',
            '', 'During extension development, if the standalone bridge code changes, run Connect after rebuilding and restart the client\'s MCP server to load the new launcher. Its arguments stay the same.',
            '', 'Your AI client\'s settings have not been changed by this command. Save the entry in that client to finish setup. Keep these local settings out of version control; they contain local paths but no authentication tokens.',
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
