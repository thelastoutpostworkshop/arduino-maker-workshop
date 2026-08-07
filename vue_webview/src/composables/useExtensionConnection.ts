import { onMounted, onUnmounted, ref } from "vue";
import { ARDUINO_MESSAGES } from "@shared/messages";

export type ExtensionConnectionState = "waiting" | "connected" | "disconnected";

const DISCONNECT_TIMEOUT_MS = 5_000;

/**
 * Webview-side half of the workaround for microsoft/vscode#70656.
 * Keep the lifecycle workaround isolated so it can be deleted when VS Code
 * provides native auto-close behavior for extension-host restarts.
 */
export function useExtensionConnection() {
    const state = ref<ExtensionConnectionState>(import.meta.env.DEV ? "connected" : "waiting");
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function armDisconnectTimer(): void {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        disconnectTimer = setTimeout(() => { state.value = "disconnected"; }, DISCONNECT_TIMEOUT_MS);
    }

    function handleMessage(message: { command?: string }): boolean {
        if (message.command !== ARDUINO_MESSAGES.EXTENSION_HEARTBEAT) return false;
        state.value = "connected";
        armDisconnectTimer();
        return true;
    }

    onMounted(() => {
        if (!import.meta.env.DEV) armDisconnectTimer();
    });

    onUnmounted(() => {
        if (disconnectTimer) clearTimeout(disconnectTimer);
    });

    return { connectionState: state, handleConnectionMessage: handleMessage };
}
