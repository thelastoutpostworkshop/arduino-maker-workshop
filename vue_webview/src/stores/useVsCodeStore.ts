import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, ArduinoBoardConfigurationPayload, ArduinoCLIStatus, ArduinoConfiguration, BoardConfiguration, WebviewToExtensionMessage, PlatformsList, CorePlatforms, Libsearch, Liblist, BoardConnected } from '@shared/messages';
import { vscode } from '@/utilities/vscode';

async function loadMockData(mockFile: string, jsonToString: boolean = true): Promise<string> {
    try {
        const response = await fetch(`/mock/${mockFile}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${mockFile}: ${response.statusText}`);
        }
        const mockData = await response.json();
        if (jsonToString) {
            return JSON.stringify(mockData);
        } else {
            return mockData;
        }
    } catch (error) {
        console.error('Error loading mock data:', error);
        return '';
    }
}

export const useVsCodeStore = defineStore('vsCode', {
    state: () => ({
        cliStatus: null as ArduinoCLIStatus | null,
        projectInfo: null as ArduinoConfiguration | null,
        projectStatus: null as WebviewToExtensionMessage | null,
        boardConfiguration: null as ArduinoBoardConfigurationPayload | null,
        boards: null as PlatformsList | null,
        boardConnected:null as BoardConnected | null,
        platform: null as CorePlatforms | null,
        libraries: null as Libsearch | null,
        librariesInstalled: null as Liblist | null,
        boardUpdating: "",
        libraryUpdating: ""
    }),
    actions: {
        mockMessage(message: WebviewToExtensionMessage) {
            if (import.meta.env.DEV) {
                switch (message.command) {
                    case ARDUINO_MESSAGES.CORE_SEARCH:
                        loadMockData('coresearch.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.LIBRARY_SEARCH:
                        loadMockData('libsearch.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.LIBRARY_INSTALLED:
                        loadMockData('libinstalled.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_STATUS:
                        loadMockData('cliversion.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.BOARD_CONFIGURATION:
                        loadMockData('board_details.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                        loadMockData('arduino_configuration.json', false).then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                        message.payload = "";
                        this.handleMessage(message);
                        break;
                    case ARDUINO_MESSAGES.BOARDS_LIST_ALL:
                        loadMockData('board_search.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.BOARD_CONNECTED:
                        loadMockData('board_connected.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    default:
                        break;
                }
            }
        },
        handleMessage(message: WebviewToExtensionMessage) {
            switch (message.command) {
                case ARDUINO_MESSAGES.CLI_STATUS:
                    if (message.errorMessage !== "") {
                        this.cliStatus = {
                            version: "?",
                            date: "Arduino CLI not set or wrong"
                        };
                    } else {
                        try {
                            const cliInfo = JSON.parse(message.payload);
                            this.cliStatus = {
                                version: cliInfo.VersionString,
                                date: cliInfo.Date
                            };
                        } catch (error) {
                            this.cliStatus = {
                                version: "?",
                                date: `${error}`
                            };
                        }
                    }
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                    this.projectInfo = message.payload;
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    this.projectStatus = message;
                    break;
                case ARDUINO_MESSAGES.BOARD_CONFIGURATION:
                    try {
                        if (message.errorMessage === "") {
                            this.boardConfiguration = {
                                errorMessage: "",
                                boardConfiguration: extractBoardConfiguration(message.payload)
                            };
                        } else {
                            this.boardConfiguration = {
                                errorMessage: message.errorMessage,
                                boardConfiguration: null
                            };
                        }

                    } catch (error) {
                        console.log("Failed to parse Board Configuration information.");
                    }
                    break;
                case ARDUINO_MESSAGES.BOARDS_LIST_ALL:
                    try {
                        this.boards = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse Board Configuration information: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.BOARD_CONNECTED:
                    try {
                        this.boardConnected = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse Board Connected information: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CORE_SEARCH:
                    try {
                        this.platform = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse core search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.LIBRARY_SEARCH:
                    try {
                        this.libraries = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse library search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.LIBRARY_INSTALLED:
                    try {
                        this.librariesInstalled = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse library search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CORE_UNINSTALLED:
                case ARDUINO_MESSAGES.CORE_VERSION_INSTALLED:
                    this.boardUpdating = "";
                    this.platform = null;
                    vscode.postMessage({ command: ARDUINO_MESSAGES.CORE_SEARCH, errorMessage: "", payload: "" });
                    break;

                default:
                    console.warn('Unknown command received:', message.command);
            }
        },
    },
});

function extractBoardConfiguration(boardConf: string): BoardConfiguration {
    const currentConfig = JSON.parse(boardConf);
    return currentConfig;
}
