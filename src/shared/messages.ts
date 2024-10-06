// Define the types of messages your extension and webview can exchange

export interface WebviewToExtensionMessage {
    command: string;
    errorMessage: string,
    payload: any | ArduinoBoardConfigurationPayload | ArduinoProjectInfoPayload | ArduinoCLIStatusPayload | ArduinoBoardsListPayload; 
}

export interface ArduinoBoardConfigurationPayload {
    errorMessage:string;
    configuration: string;
    boardName: string;
}

export interface ArduinoCLIStatusPayload {
    errorMessage:string;
    version: string;
    date: string;
}

export interface ArduinoBoardsListPayload {
    errorMessage:string;
    boardStructure: any;
    uniqueFqbnSet: any;
}

export interface ArduinoProjectInfoPayload {
    errorMessage:string;
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
    BOARD_CONFIGURATION: 'getArduinoBoardConfiguration',
    BOARDS_LIST_ALL:'getArduinoBoardsListAll'
    // Add more commands as needed
};
