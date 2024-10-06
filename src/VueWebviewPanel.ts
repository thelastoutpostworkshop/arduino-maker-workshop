import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { ARDUINO_MESSAGES, ArduinoBoardConfigurationPayload, ArduinoBoardsListPayload, WebviewToExtensionMessage } from './shared/messages';
import { arduinoConfigurationLastError, arduinoExtensionChannel, arduinoProject, checkArduinoCLICommand, getBoardConfiguration, getBoardsListAll, loadArduinoConfiguration, processArduinoCLICommandCheck } from "./extension";
import { ARDUINO_ERRORS } from "./ArduinoProject";

const path = require('path');
const fs = require('fs');

export class VueWebviewPanel {

    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];
    public static currentPanel: VueWebviewPanel | undefined;

    private constructor(panel: WebviewPanel, extensionUri: Uri) {
        this._panel = panel;

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => {
                switch (message.command) {
                    case ARDUINO_MESSAGES.CLI_STATUS:
                        checkArduinoCLICommand().then((result) => {
                            VueWebviewPanel.sendMessage(processArduinoCLICommandCheck(result));
                        });
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                        const projectStatus: WebviewToExtensionMessage = {
                            command: ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS,
                            errorMessage: "",
                            payload: ""
                        };
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
                        VueWebviewPanel.sendMessage(projectStatus);
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                        const projectInfo: WebviewToExtensionMessage = {
                            command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO,
                            errorMessage: "",
                            payload: ""
                        };
                        if (loadArduinoConfiguration()) {
                            projectInfo.payload = arduinoProject.getArduinoConfiguration();
                        } else {
                            projectInfo.errorMessage = "Not an Arduino Project";
                        }
                        VueWebviewPanel.sendMessage(projectInfo);
                        break;
                    case ARDUINO_MESSAGES.BOARD_CONFIGURATION:
                        getBoardConfiguration(message.payload).then((result) => {
                            const boardConfiguration: WebviewToExtensionMessage = {
                                command: ARDUINO_MESSAGES.BOARD_CONFIGURATION,
                                errorMessage: "",
                                payload: ""
                            };
                            if (result !== "") {
                                try {
                                    const configData = JSON.parse(result);
                                    boardConfiguration.payload = <ArduinoBoardConfigurationPayload>{
                                        configuration: configData.config_options,
                                        boardName: configData.name
                                    };

                                } catch (error) {
                                    boardConfiguration.errorMessage = "Cannot parse Board configuration";
                                }
                            } else {
                                boardConfiguration.errorMessage = "Cannot get Board configuration";
                            }
                            VueWebviewPanel.sendMessage(boardConfiguration);
                        });
                        break;
                    case ARDUINO_MESSAGES.BOARDS_LIST_ALL:
                        getBoardsListAll().then((result:ArduinoBoardsListPayload) => {
                            const boardList: WebviewToExtensionMessage = {
                                command: ARDUINO_MESSAGES.BOARDS_LIST_ALL,
                                errorMessage: result.errorMessage,
                                payload: JSON.stringify({
                                    boardStructure:result.boardStructure,
                                    uniqueFqbnSet:result.uniqueFqbnSet
                                })
                            };
                            VueWebviewPanel.sendMessage(boardList);
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
                'Vue Webview', // Title of the panel displayed to the user
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
        arduinoExtensionChannel.appendLine(nonce);

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