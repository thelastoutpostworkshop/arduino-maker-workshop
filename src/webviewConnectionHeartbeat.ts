import { Disposable, WebviewPanel } from "vscode";
import { ARDUINO_MESSAGES } from "./shared/messages";

/**
 * Workaround for microsoft/vscode#70656.
 *
 * VS Code can restart the extension host while keeping a WebviewPanel open.
 * The surviving webview is then disconnected from the new extension host, and
 * WebviewPanelSerializer is not invoked. Remove this class when VS Code offers
 * a native lifecycle option such as microsoft/vscode#225979.
 */
export class WebviewConnectionHeartbeat implements Disposable {
    private static readonly INTERVAL_MS = 1_000;
    private readonly timer: NodeJS.Timeout;
    private readonly subscriptions: Disposable[] = [];
    private disposed = false;

    public constructor(private readonly panel: WebviewPanel) {
        this.subscriptions.push(
            panel.webview.onDidReceiveMessage((message: { command?: string } | undefined) => {
                if (message?.command === ARDUINO_MESSAGES.WEBVIEW_READY
                    || message?.command === ARDUINO_MESSAGES.WEBVIEW_HEARTBEAT_REQUEST) {
                    void this.postHeartbeat();
                }
            }),
            panel.onDidChangeViewState(({ webviewPanel }) => {
                if (webviewPanel.visible || webviewPanel.active) {
                    void this.postHeartbeat();
                }
            })
        );
        void this.postHeartbeat();
        this.timer = setInterval(() => { void this.postHeartbeat(); }, WebviewConnectionHeartbeat.INTERVAL_MS);
    }

    public dispose(): void {
        this.disposed = true;
        clearInterval(this.timer);
        for (const subscription of this.subscriptions.splice(0)) {
            subscription.dispose();
        }
    }

    private async postHeartbeat(): Promise<void> {
        if (this.disposed) { return; }
        try {
            await this.panel.webview.postMessage({
                command: ARDUINO_MESSAGES.EXTENSION_HEARTBEAT,
                errorMessage: "",
                payload: ""
            });
        } catch {
            // A panel can be disposed while a heartbeat is in flight.
        }
    }
}
