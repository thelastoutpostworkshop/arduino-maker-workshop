import { onMounted, onUnmounted, ref } from "vue";
import { ARDUINO_MESSAGES } from "@shared/messages";
import { vscode } from "@/utilities/vscode";

export type ExtensionConnectionState = "waiting" | "connected" | "disconnected";

const DISCONNECT_TIMEOUT_MS = 5_000;

/**
 * Webview-side half of the workaround for microsoft/vscode#70656.
 * Keep the lifecycle workaround isolated so it can be deleted when VS Code
 * provides native auto-close behavior for extension-host restarts.
 */
export function useExtensionConnection() {
    const state = ref<ExtensionConnectionState>(import.meta.env.DEV ? "connected" : "waiting");
    const hasConnected = ref(import.meta.env.DEV);
    let monitoring = !import.meta.env.DEV;
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function isForeground(): boolean {
        return !document.hidden && document.hasFocus();
    }

    function pause(): void {
        if (disconnectTimer !== undefined) { clearTimeout(disconnectTimer); }
        disconnectTimer = undefined;
    }

    function requestHeartbeat(): void {
        vscode.postMessage({ command: ARDUINO_MESSAGES.WEBVIEW_HEARTBEAT_REQUEST, errorMessage: "", payload: "" });
    }

    function armDisconnectTimer(awaitingReply = false): void {
        pause();
        if (!monitoring || !isForeground()) { return; }
        disconnectTimer = setTimeout(() => {
            disconnectTimer = undefined;
            if (!isForeground()) { return; }
            if (awaitingReply) {
                state.value = "disconnected";
            } else {
                // A delayed timer or heartbeat alone is not proof of a lost host.
                // Give an explicit probe a fresh response window before hiding the UI.
                armDisconnectTimer(true);
                requestHeartbeat();
            }
        }, DISCONNECT_TIMEOUT_MS);
    }

    function resume(): void {
        pause();
        if (!monitoring || !isForeground()) { return; }
        armDisconnectTimer(true);
        requestHeartbeat();
    }

    function handleMessage(message: { command?: string } | null | undefined): boolean {
        if (message?.command !== ARDUINO_MESSAGES.EXTENSION_HEARTBEAT) { return false; }
        monitoring = true;
        hasConnected.value = true;
        state.value = "connected";
        armDisconnectTimer();
        return true;
    }

    onMounted(() => {
        // Explorer, another editor, and hidden panels may pause webview messages.
        document.addEventListener("visibilitychange", resume);
        window.addEventListener("focus", resume);
        window.addEventListener("blur", pause);
        resume();
    });

    onUnmounted(() => {
        pause();
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("focus", resume);
        window.removeEventListener("blur", pause);
    });

    return { connectionState: state, hasConnected, handleConnectionMessage: handleMessage };
}
