// src/VueWebviewPanel.ts

import * as vscode from 'vscode';
const path = require('path');
const fs = require('fs');

export class VueWebviewPanel {

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    public static currentPanel: VueWebviewPanel | undefined;


    public static createOrShow(extensionContext: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (VueWebviewPanel.currentPanel) {
            VueWebviewPanel.currentPanel._panel.reveal(column);
        } else {
            // Otherwise, create a new panel.
            const panel = vscode.window.createWebviewPanel(
                'vueWebview', // Identifies the type of the webview. Used internally
                'Vue Webview', // Title of the panel displayed to the user
                column || vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(extensionContext.extensionUri,'dist','assets'),
    
                    ],
                }
            );

            VueWebviewPanel.currentPanel = new VueWebviewPanel(panel, extensionContext);
        }
    }



    private constructor(panel: vscode.WebviewPanel, extensionContext: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionContext = extensionContext;

        // Set the webview's initial html content
        this._panel.webview.html = this._getHtmlForWebview();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message) => {
                // Handle messages received from the webview
            },
            null,
            this._disposables
        );

        // Dispose of resources when the panel is closed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
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

    private _getHtmlForWebview() {
        const webview = this._panel.webview;

        // Path to the built index.html file
        const indexPath = vscode.Uri.joinPath(
            this._extensionContext.extensionUri,
            'vue_webview',
            'dist',
            'index.html'
        );

        let html = fs.readFileSync(indexPath.fsPath, 'utf8');

        // Update the HTML to load resources correctly in the webview
        html = this._updateHtmlForWebview(html, webview);

        return html;
    }

    private _updateHtmlForWebview(html: string, webview: vscode.Webview): string {
        // Replace resource paths
        html = html.replace(/(["'])(\/?assets\/.+?\.(?:js|css|png|jpg|gif|svg))\1/g, (match, p1, p2) => {
            const resourcePath = vscode.Uri.joinPath(
                this._extensionContext.extensionUri,
                'vue_webview',
                'dist',
                p2
            );
            const webviewUri = webview.asWebviewUri(resourcePath);
            return `${p1}${webviewUri.toString()}${p1}`;
        });

        // Generate a nonce
        const nonce = getNonce();

        // Inject CSP meta tag
        html = html.replace(
            /<meta charset="UTF-8">/,
            `<meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        img-src ${webview.cspSource} https:;
        script-src 'nonce-${nonce}' ${webview.cspSource};
        style-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-inline';
        font-src ${webview.cspSource};
        connect-src ${webview.cspSource};
      ">
      `
        );

        // Add nonce to script and style tags
        html = html.replace(/<script\b(?![^>]*\bnonce=)[^>]*>/gi, (match) => {
            return match.replace('>', ` nonce="${nonce}">`);
        });

        html = html.replace(/<link\b(?![^>]*\bnonce=)[^>]*rel=["']stylesheet["'][^>]*>/gi, (match) => {
            return match.replace('>', ` nonce="${nonce}">`);
        });

        return html;
    }
}

function getNonce() {
    let text = '';
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
