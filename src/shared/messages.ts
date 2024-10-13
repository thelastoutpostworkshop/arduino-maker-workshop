// Define the types of messages your extension and webview can exchange

export interface WebviewToExtensionMessage {
    command: string;
    errorMessage: string,
    payload: any | ArduinoBoardConfigurationPayload | ArduinoProjectInfoPayload | ArduinoCLIStatusPayload | ArduinoBoardsListPayload; 
}

export interface ArduinoBoardConfigurationPayload {
    errorMessage:string;
    boardConfiguration: BoardConfiguration | null;
}

export interface ArduinoCLIStatusPayload {
    errorMessage:string;
    version: string;
    date: string;
}

export interface ArduinoBoardsListPayload {
    errorMessage:string;
    boardStructure: any;
}

export interface ArduinoProjectInfoPayload {
    errorMessage:string;
    configuration: string;
    board: string;
    sketch:string;
    output:string;
    port:string;
}

export interface BoardConfiguration {
    fqbn: string;
    name: string;
    version: string;
    config_options: ConfigOption[];
    programmers: Programmer[];
}

export interface ConfigOptionValue {
    value: string;
    value_label: string;
    selected?: boolean;
}

interface ConfigOption {
    option: string;
    option_label: string;
    values: ConfigOptionValue[];
}

interface Programmer {
    platform: string;
    id: string;
    name: string;
}

export const ARDUINO_MESSAGES = {
    CLI_STATUS: 'getArduinoCLIStatus',
    ARDUINO_PROJECT_STATUS: 'getArduinoProjectStatus',
    ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',
    BOARD_CONFIGURATION: 'getArduinoBoardConfiguration',
    BOARDS_LIST_ALL:'getArduinoBoardsListAll',
    SET_BOARD:'setArduinoBoard',
    SET_BOARD_CONFIGURATION:'setArduinoBoardConfiguration'
    // Add more commands as needed
};
