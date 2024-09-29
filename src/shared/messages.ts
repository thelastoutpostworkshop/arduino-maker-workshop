// src/shared/messages.ts

// Define the types of messages your extension and webview can exchange

export interface ExtensionToWebviewMessage {
    command: string;
    payload?: any;
}

export interface WebviewToExtensionMessage {
    command: string;
    payload?: any;
}

// Define constants for your message commands

export const MESSAGE_COMMANDS = {
    ARDUINO_PROJECT_STATUT: 'getArduinoProjectStatus',
    ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',
    // Add more commands as needed
};
