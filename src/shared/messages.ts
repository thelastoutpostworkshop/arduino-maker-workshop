// Define the types of messages your extension and webview can exchange

export interface WebviewToExtensionMessage {
    command: string;
    errorMessage: string,
    payload: any | ArduinoBoardConfigurationPayload | ArduinoProjectInfoPayload;
}

export interface ArduinoBoardConfigurationPayload {
    configuration: string;
    boardName: string;
}

export interface ArduinoProjectInfoPayload {
    configuration: string;
    board: string;
    sketch:string;
    output:string;
    port:string;
}

export const ARDUINO_MESSAGES = {
    CLI_STATUS: 'getArduinoCLIStatus',
    ARDUINO_PROJECT_STATUS: 'getArduinoProjectStatus',
    ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',
    BOARD_CONFIGURATION: 'getArduinoBoardConfiguration'
    // Add more commands as needed
};
