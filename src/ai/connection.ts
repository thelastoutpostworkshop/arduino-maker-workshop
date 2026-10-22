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
                `Arduino Maker Workshop (${path.basename(options.activeSketchPath() ?? '')})`,
                process.execPath,
                [launcherPath, '--session', session.sessionFile],
                { ELECTRON_RUN_AS_NODE: '1' },
                `${context.extension.packageJSON.version}:${session.sessionId}`
            )] : [],
            resolveMcpServerDefinition: (definition: unknown) => session && vscode.workspace.isTrusted ? definition : undefined,
        }));
    }

    const showSetup = async () => {
        const sketchPath = options.activeSketchPath();
        if (!session || !sketchPath) {
            throw new AiBridgeError('BRIDGE_DISABLED', 'Connect an AI assistant from the selected VS Code window first.');
        }
        const args = [launcherPath, '--sketch', sketchPath, '--session-dir', path.dirname(launcherPath)];
        const codex = `[mcp_servers.arduino_maker_workshop]\ncommand = "node"\nargs = ${JSON.stringify(args)}\ntool_timeout_sec = 900\n`;
        const claude = JSON.stringify({ mcpServers: { arduino_maker_workshop: { type: 'stdio', command: 'node', args } } }, null, 2);
        const copilot = JSON.stringify({ servers: { arduino_maker_workshop: { type: 'stdio', command: 'node', args } } }, null, 2);
        const markdown = [
            '# Arduino Maker Workshop - AI connection',
            '',
            `Selected sketch: ${sketchPath}`,
            '',
            'This session is enabled only in this window until Disconnect, reload, or close. Each compile asks for approval here. No upload or serial tools are available.',
            '',
            'These snippets stay valid across reloads for this sketch and VS Code storage location. After each reload, run Connect AI Assistant again; the client reconnects on its next tool call. A failed or interrupted compile is never retried automatically.',
            '',
            'The snippets contain the selected sketch and bridge storage paths, not authentication tokens. Keep session descriptors private and do not commit machine-specific client configuration. Node.js 20 or newer must be available to external clients on this same machine.',
            '',
            '## Copilot / VS Code',
            '',
            'On versions supporting the MCP definition API, select the Arduino Maker Workshop server in the MCP tools picker. On older versions, MCP itself may be unavailable; otherwise manually add this user/profile MCP configuration:',
            '', '```json', copilot, '```',
            '', '## Codex IDE and CLI',
            '', 'Manually add this to your host\'s ~/.codex/config.toml. These clients share that MCP configuration:',
            '', '```toml', codex, '```',
            '', '## Claude Code',
            '', 'Use Claude Code\'s MCP setup or manually merge this into your chosen local/project MCP configuration:',
            '', '```json', claude, '```',
            '', 'The launcher requires exactly one connected session for the specified sketch. If that sketch is connected in multiple windows, disconnect the extra sessions. Session descriptors and tokens still change after every reconnect; no session is enabled automatically. The native VS Code MCP provider stays tied to its specific window session.',
            '', 'This command has not edited any client configuration. Actual client interoperability must be tested separately.',
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
