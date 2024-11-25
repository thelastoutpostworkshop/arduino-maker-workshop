import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { ARDUINO_MESSAGES, ArduinoProjectStatus, WebviewToExtensionMessage } from './shared/messages';
import { arduinoCLI, arduinoExtensionChannel, arduinoProject, getBoardConfiguration, loadArduinoConfiguration, openExample } from "./extension";
import { createNewSketch } from "./cli";

const usb = require('usb').usb;

export class VueWebviewPanel {

    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];
    public static currentPanel: VueWebviewPanel | undefined;
    private usbChange() {
        VueWebviewPanel.sendMessage({ command: ARDUINO_MESSAGES.REQUEST_BOARD_CONNECTED, errorMessage: "", payload: "" });
    }
    private constructor(panel: WebviewPanel, extensionUri: Uri) {
        this._panel = panel;
        usb.on("attach", () => {
            this.usbChange();
        });
        usb.on("detach", () => {
            this.usbChange();
        });
        // Handle messages from the Vue web application
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => {
                arduinoExtensionChannel.appendLine(`Message from Vue App: ${message.command}`);
                switch (message.command) {
                    case ARDUINO_MESSAGES.CLI_CREATE_NEW_SKETCH:
                        createNewSketch(message.payload);
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                        arduinoCLI.checkArduinoCLICommand().then((clistatus) => {
                            const projectStatus: ArduinoProjectStatus = { project_status: arduinoProject.isFolderArduinoProject(), cli_status: clistatus };
                            message.payload = projectStatus;
                            VueWebviewPanel.sendMessage(message);
                        });
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
                    case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                        getBoardConfiguration().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        }).catch(() => {
                            // Board info is wrong or not installed
                            arduinoProject.setBoard("");
                            arduinoProject.setConfiguration("");
                            arduinoProject.setPort("");
                            message.payload = "";
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                        arduinoCLI.getBoardsListAll().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
                        arduinoCLI.getBoardConnected().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_BOARD_OPTIONS:
                        this.setConfiguration(message);
                        break;
                    case ARDUINO_MESSAGES.SET_BOARD:
                        this.setBoard(message);
                        arduinoProject.resetBoardConfiguration();
                        arduinoExtensionChannel.appendLine(`Current Board Configuration: ${arduinoProject.getBoardConfiguration()}`);
                        getBoardConfiguration().then((result) => {
                            message.command = ARDUINO_MESSAGES.CLI_BOARD_OPTIONS;
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_PORT:
                        this.setPort(message);
                        break;
                    case ARDUINO_MESSAGES.CLI_UPDATE_INDEX:
                        arduinoCLI.getCoreUpdate().then(() => {
                            arduinoCLI.getOutdatedBoardAndLib().then((result) => {
                                message.payload = result;
                                VueWebviewPanel.sendMessage(message);
                            });
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_INSTALL_CORE_VERSION:
                        const coreToUpdate = message.payload;
                        arduinoCLI.runInstallCoreVersion(coreToUpdate).then(() => {
                            message.command = ARDUINO_MESSAGES.CORE_VERSION_INSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_INSTALL_LIBRARY:
                        const libToInstall = message.payload;
                        arduinoCLI.runInstallLibraryVersion(libToInstall).then(() => {
                            message.command = ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_UNINSTALL_LIBRARY:
                        arduinoCLI.runUninstallLibrary(message.payload).then(() => {
                            message.command = ARDUINO_MESSAGES.LIBRARY_UNINSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_UNINSTALL_CORE:
                        const coreToUninstall = message.payload;
                        arduinoCLI.runUninstallCoreVersion(coreToUninstall).then(() => {
                            message.command = ARDUINO_MESSAGES.CORE_UNINSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                        arduinoCLI.searchCore().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                        arduinoCLI.searchLibrary().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                        arduinoCLI.searchLibraryInstalled().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_OUTDATED:
                        arduinoCLI.getOutdatedBoardAndLib().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.OPEN_LIBRARY:
                        openExample(message.payload);
                        break;
                    case ARDUINO_MESSAGES.CLI_GET_CONFIG:
                        arduinoCLI.getCLIConfig().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_REMOVE_ADDITIONAL_URL:
                        arduinoCLI.removeCLIConfigAdditionalBoardURL(message.payload).then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_ADD_ADDITIONAL_URL:
                        arduinoCLI.addCLIConfigAdditionalBoardURL(message.payload).then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_SET_ADDITIONAL_URL:
                        arduinoCLI.setCLIConfigAdditionalBoardURL(message.payload).then((result) => {
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
                    retainContextWhenHidden: true,
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