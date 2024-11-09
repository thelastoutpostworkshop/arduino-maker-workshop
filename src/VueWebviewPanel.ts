import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { ARDUINO_MESSAGES, WebviewToExtensionMessage, ARDUINO_ERRORS } from './shared/messages';
import { arduinoConfigurationLastError, arduinoExtensionChannel, arduinoProject, checkArduinoCLICommand, getBoardConfiguration, getBoardConnected, getBoardsListAll, getCoreUpdate, getOutdatedBoardAndLib, loadArduinoConfiguration, processArduinoCLICommandCheck, runInstallCoreVersion, runUninstallCoreVersion, searchCore, searchLibrary, searchLibraryInstalled } from "./extension";

const path = require('path');
const fs = require('fs');

export class VueWebviewPanel {

    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];
    public static currentPanel: VueWebviewPanel | undefined;

    private constructor(panel: WebviewPanel, extensionUri: Uri) {
        this._panel = panel;
        // Handle messages from the Vue web application
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => {
                arduinoExtensionChannel.appendLine(`Message from Vue App: ${message.command}`);
                switch (message.command) {
                    case ARDUINO_MESSAGES.CREATE_NEW_SKETCH:
                        break;
                    case ARDUINO_MESSAGES.CLI_STATUS:
                        checkArduinoCLICommand().then((result) => {
                            const sendMessage = processArduinoCLICommandCheck(result);
                            VueWebviewPanel.sendMessage(sendMessage);
                        });
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                        const projectStatus = arduinoProject.isFolderArduinoProject();
                        message.payload = projectStatus;
                        VueWebviewPanel.sendMessage(message);
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                        const projectInfo = this.createWebviewMessage(ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO);
                        if (loadArduinoConfiguration()) {
                            projectInfo.payload = arduinoProject.getArduinoConfiguration();
                        } else {
                            projectInfo.errorMessage = "Not an Arduino Project";
                        }
                        VueWebviewPanel.sendMessage(projectInfo);
                        break;
                    case ARDUINO_MESSAGES.BOARD_CONFIGURATION:
                        getBoardConfiguration().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.BOARDS_LIST_ALL:
                        getBoardsListAll().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.BOARD_CONNECTED:
                        getBoardConnected().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_BOARD_CONFIGURATION:
                        this.setConfiguration(message);
                        break;
                    case ARDUINO_MESSAGES.SET_BOARD:
                        this.setBoard(message);
                        arduinoProject.resetBoardConfiguration();
                        arduinoExtensionChannel.appendLine(`Current Board Configuration: ${arduinoProject.getBoardConfiguration()}`);
                        getBoardConfiguration().then((result) => {
                            message.command = ARDUINO_MESSAGES.BOARD_CONFIGURATION;
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_PORT:
                        this.setPort(message);
                        break;
                    case ARDUINO_MESSAGES.OUTDATED:
                        getCoreUpdate().then(() => {
                            getOutdatedBoardAndLib().then((result) => {
                                message.payload = result;
                                VueWebviewPanel.sendMessage(message);
                            });
                        });
                        break;
                    case ARDUINO_MESSAGES.INSTALL_CORE_VERSION:
                        const coreToUpdate = message.payload;
                        runInstallCoreVersion(coreToUpdate).then(() => {
                            message.command = ARDUINO_MESSAGES.CORE_VERSION_INSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.UNINSTALL_CORE:
                        const coreToUninstall = message.payload;
                        runUninstallCoreVersion(coreToUninstall).then(() => {
                            message.command = ARDUINO_MESSAGES.CORE_UNINSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CORE_SEARCH:
                        searchCore().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.LIBRARY_SEARCH:
                        searchLibrary().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.LIBRARY_INSTALLED:
                        searchLibraryInstalled().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    default:
                        arduinoExtensionChannel.appendLine(`Unknown command received from webview: ${message.command}`);
                }
            },
            null,
            this._disposables
        );

        // Dispose of resources when the panel is closed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
        arduinoExtensionChannel.appendLine("Arduino Web view ready");
    }

    private setBoard(message: WebviewToExtensionMessage) {
        const fqbn = message.payload;
        arduinoExtensionChannel.appendLine(`Set Board FQBN=:${fqbn}`);
        arduinoProject.setBoard(fqbn);
    }

    private setConfiguration(message: WebviewToExtensionMessage) {
        const configuration = message.payload;
        arduinoExtensionChannel.appendLine(`New Configration=:${configuration}`);
        arduinoProject.setConfiguration(configuration);
    }

    private setPort(message: WebviewToExtensionMessage) {
        const port = message.payload;
        arduinoExtensionChannel.appendLine(`New Port=:${port}`);
        arduinoProject.setPort(port);
    }

    private createWebviewMessage(command: string): WebviewToExtensionMessage {
        return {
            command: command,
            errorMessage: "",
            payload: ""
        };
    }
    private async getBoardListAll(): Promise<WebviewToExtensionMessage> {
        const outdated = this.createWebviewMessage(ARDUINO_MESSAGES.BOARDS_LIST_ALL);
        const result = await getBoardsListAll();
        if (result !== "") {
            outdated.payload = result;
        }
        return outdated;
    }
    private async getBoardConnected(): Promise<WebviewToExtensionMessage> {
        const outdated = this.createWebviewMessage(ARDUINO_MESSAGES.BOARD_CONNECTED);
        const result = await getBoardConnected();
        if (result !== "") {
            outdated.payload = result;
        }
        return outdated;
    }

    private async installCoreVersion(version: string): Promise<WebviewToExtensionMessage> {
        const installCoreVersionResult = this.createWebviewMessage(ARDUINO_MESSAGES.INSTALL_CORE_VERSION);
        const result = await runInstallCoreVersion(version);
        if (result !== "") {
            installCoreVersionResult.payload = result;
        }
        return installCoreVersionResult;
    }
    private async uninstallCoreVersion(board_id: string): Promise<WebviewToExtensionMessage> {
        const uninstallCoreVersionResult = this.createWebviewMessage(ARDUINO_MESSAGES.UNINSTALL_CORE);
        const result = await runUninstallCoreVersion(board_id);
        if (result !== "") {
            uninstallCoreVersionResult.payload = result;
        }
        return uninstallCoreVersionResult;
    }
    private async searchCore(): Promise<WebviewToExtensionMessage> {
        const coreSearchResult = this.createWebviewMessage(ARDUINO_MESSAGES.CORE_SEARCH);
        const result = await searchCore();
        if (result !== "") {
            coreSearchResult.payload = result;
        }
        return coreSearchResult;
    }
    private async searchLibraryInstalled(): Promise<WebviewToExtensionMessage> {
        const libInstalled = this.createWebviewMessage(ARDUINO_MESSAGES.LIBRARY_INSTALLED);
        const result = await searchLibraryInstalled();
        if (result !== "") {
            libInstalled.payload = result;
        }
        return libInstalled;
    }
    private async searchLibrary(): Promise<WebviewToExtensionMessage> {
        const libSearchResult = this.createWebviewMessage(ARDUINO_MESSAGES.LIBRARY_SEARCH);
        const result = await searchLibrary();
        if (result !== "") {
            libSearchResult.payload = result;
        }
        return libSearchResult;
    }
    private async runCoreUpdate(): Promise<WebviewToExtensionMessage> {
        const coreUpdateResult = this.createWebviewMessage(ARDUINO_MESSAGES.OUTDATED);
        const result = await getCoreUpdate();
        if (result !== "") {
            coreUpdateResult.payload = result;
        }
        return coreUpdateResult;
    }
    private async getOutdated(): Promise<WebviewToExtensionMessage> {
        const outdated = this.createWebviewMessage(ARDUINO_MESSAGES.OUTDATED);
        const result = await getOutdatedBoardAndLib();
        if (result !== "") {
            outdated.payload = result;
        }
        return outdated;
    }
    private async getBoardConfiguration(): Promise<WebviewToExtensionMessage> {
        const boardConfiguration = this.createWebviewMessage(ARDUINO_MESSAGES.BOARD_CONFIGURATION);
        const result = await getBoardConfiguration();
        if (result !== "") {
            boardConfiguration.payload = result;
        }
        return boardConfiguration;
    }

    private getArduinoProjectInfo(): WebviewToExtensionMessage {
        const projectInfo = this.createWebviewMessage(ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO);
        if (loadArduinoConfiguration()) {
            projectInfo.payload = arduinoProject.getArduinoConfiguration();
        } else {
            projectInfo.errorMessage = "Not an Arduino Project";
        }
        return projectInfo;
    }

    private getArduinoProjectStatus(): WebviewToExtensionMessage {
        const projectStatus = this.createWebviewMessage(ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS);
        if (!loadArduinoConfiguration()) {
            switch (arduinoConfigurationLastError) {
                case ARDUINO_ERRORS.NO_INO_FILES:
                    projectStatus.errorMessage = "No sketch file (.ino) found";
                    break;
                case ARDUINO_ERRORS.WRONG_FOLDER_NAME:
                    projectStatus.errorMessage = "Folder and sketch name mismatch";
                    break;
                default:
                    projectStatus.errorMessage = "Unknown error in Arduino Project Configuration";
                    break;
            }
        } else {
            projectStatus.errorMessage = "";
        }
        return projectStatus;
    }

    private async getCliStatus(): Promise<WebviewToExtensionMessage> {
        const result = await checkArduinoCLICommand();
        return processArduinoCLICommandCheck(result);
    }

    public static sendMessage(message: WebviewToExtensionMessage) {
        if (VueWebviewPanel.currentPanel) {
            VueWebviewPanel.currentPanel._panel.webview.postMessage(message);
            // arduinoExtensionChannel.appendLine(`Message to vue app: ${message.payload}`);
        } else {
            arduinoExtensionChannel.appendLine("Attempted to send message, but the webview panel is not active.");
        }
    }

    public static render(extensionUri: Uri) {

        // If we already have a panel, show it.
        if (VueWebviewPanel.currentPanel) {
            VueWebviewPanel.currentPanel._panel.reveal(ViewColumn.One);
        } else {
            // Otherwise, create a new panel.
            const panel = window.createWebviewPanel(
                'vueWebview', // Identifies the type of the webview. Used internally
                'Arduino Home', // Title of the panel displayed to the user
                ViewColumn.One,
                {
                    enableScripts: true,
                    // retainContextWhenHidden: true,
                    localResourceRoots: [
                        Uri.joinPath(extensionUri, "build"),
                        Uri.joinPath(extensionUri, "vue_webview/dist")
                    ],
                }
            );

            VueWebviewPanel.currentPanel = new VueWebviewPanel(panel, extensionUri);
        }
    }

    public dispose() {
        VueWebviewPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getWebviewContent(webview: Webview, extensionUri: Uri) {
        const stylesUri = getUri(webview, extensionUri, ["vue_webview", "dist", "assets", "index.css"]);
        const scriptUri = getUri(webview, extensionUri, ["vue_webview", "dist", "assets", "index.js"]);

        const nonce = getNonce();
        // arduinoExtensionChannel.appendLine(nonce);

        const hmltcontent = /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <link rel="stylesheet"type="text/css" href="${stylesUri}">
            <title>Arduino</title>
        </head>
        <body>
            <div id="app"></div>
            <script nonce="${nonce}">
                window.cspNonce = '${nonce}';
            </script>
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `;
        return hmltcontent;
    }
}