// src/VueWebviewPanel.ts

import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { MESSAGE_COMMANDS, WebviewToExtensionMessage } from './shared/messages';
import { arduinoExtensionChannel } from "./extension";

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
                    case MESSAGE_COMMANDS.ARDUINO_PROJECT_STATUT:
                        arduinoExtensionChannel.appendLine("Message : ARDUINO_PROJECT_STATUT");
                        // Handle update data command
                        break;
                        case MESSAGE_COMMANDS.ARDUINO_PROJECT_INFO:
                            arduinoExtensionChannel.appendLine("Message : ARDUINO_PROJECT_INFO");
                            // Handle show alert command
                        break;
                    default:
                        arduinoExtensionChannel.appendLine(`Unknown command received from webview: ${message.command} `);
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

        return /*html*/ `
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
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `;
    }

    private _updateHtmlForWebview(html: string, webview: Webview): string {

        const nonce = getNonce();

        // Inject CSP meta tag
        html = html.replace(
            /<meta charset="UTF-8"\s*\/?>/,
            `<meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource};
            font-src ${webview.cspSource};
            img-src ${webview.cspSource} https:;
            connect-src ${webview.cspSource};
        ">
        `
        );

        // Add nonce to script and style tags
        html = html.replace(/<script\b(?![^>]*\bnonce=)[^>]*>/gi, (match) => {
            return match.replace('>', ` nonce="${nonce}">`);
        });


        return html;
    }

}