import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, ArduinoCLIStatus, ArduinoConfiguration, BoardConfiguration, WebviewToExtensionMessage, PlatformsList, CorePlatforms, Libsearch, Liblist, BoardConnected, ARDUINO_ERRORS } from '@shared/messages';
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
        projectStatus: null as ARDUINO_ERRORS | null,
        boardOptions: null as BoardConfiguration | null,
        boards: null as PlatformsList | null,
        boardConnected: null as BoardConnected | null,
        platform: null as CorePlatforms | null,
        libraries: null as Libsearch | null,
        librariesInstalled: null as Liblist | null,
        additionalBoardURLs: null as string | null,
        boardUpdating: "",
        libraryUpdating: ""
    }),
    actions: {
        mockMessage(message: WebviewToExtensionMessage) {
            if (import.meta.env.DEV) {
                switch (message.command) {
                    case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                        loadMockData('coresearch.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                        loadMockData('libsearch.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
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
                    case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                        loadMockData('board_options.json').then((mockPayload) => {
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
                        message.payload = ARDUINO_ERRORS.NO_ERRORS;
                        this.handleMessage(message);
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                        loadMockData('board_search.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
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
        sendMessage(message: WebviewToExtensionMessage) {
            switch (message.command) {
                case ARDUINO_MESSAGES.CLI_STATUS:
                    if (!this.cliStatus) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    if (!this.projectStatus) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                    if (!this.platform) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                    if (!this.boards) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                    if (!this.libraries) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                    if (!this.librariesInstalled) {
                        vscode.postMessage(message);
                    }
                    break;

                default:
                    vscode.postMessage(message);
                    break;
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
                case ARDUINO_MESSAGES.GET_ADDITIONAL_URLS:
                    this.additionalBoardURLs = message.payload;
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    this.projectStatus = message.payload;
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                    try {
                        this.boardOptions = JSON.parse(message.payload);
                        let configuration = this.boardOptions?.config_options
                            .map((configOption) => {
                                const selectedValue = configOption.values.find(value => value.selected);
                                if (selectedValue) {
                                    return `${configOption.option}=${selectedValue.value}`;
                                }
                                return null;
                            })
                            .filter((optionString) => optionString !== null) // Remove any null values from the array
                            .join(",");
                        this.sendMessage({ command: ARDUINO_MESSAGES.SET_BOARD_OPTIONS, errorMessage: "", payload: configuration });
                    } catch (error) {
                        console.log("Failed to parse Board Configuration information.");
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                    try {
                        this.boards = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse Board Configuration information: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
                    try {
                        this.boardConnected = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse Board Connected information: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                    try {
                        this.platform = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse core search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                    try {
                        this.libraries = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse library search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                    try {
                        this.librariesInstalled = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse library search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED:
                    this.libraryUpdating="";
                    this.librariesInstalled=null;
                    this.libraries=null;
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH, errorMessage: "", payload: "" });
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: "", payload: "" });
                    break;
                case ARDUINO_MESSAGES.CORE_UNINSTALLED:
                case ARDUINO_MESSAGES.CORE_VERSION_INSTALLED:
                    this.boardUpdating = "";
                    this.platform = null;
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_CORE_SEARCH, errorMessage: "", payload: "" });
                    break;

                default:
                    console.warn('Unknown command received:', message.command);
            }
        },
    },
});