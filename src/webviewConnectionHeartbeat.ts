import { Disposable, Webview } from "vscode";
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

    public constructor(private readonly webview: Webview) {
        this.postHeartbeat();
        this.timer = setInterval(() => this.postHeartbeat(), WebviewConnectionHeartbeat.INTERVAL_MS);
    }

    public dispose(): void {
        clearInterval(this.timer);
    }

    private postHeartbeat(): void {
        void this.webview.postMessage({
            command: ARDUINO_MESSAGES.EXTENSION_HEARTBEAT,
            errorMessage: "",
            payload: ""
        });
    }
}
