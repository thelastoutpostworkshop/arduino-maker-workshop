import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, ArduinoBoardConfigurationPayload, ArduinoCLIStatus, ArduinoConfiguration, BoardConfiguration, WebviewToExtensionMessage, PlatformsList, CorePlatforms, Libsearch, Liblist } from '@shared/messages';
import { vscode } from '@/utilities/vscode';
import mockDataSearchBoards from '@/mock/coresearch.json';

export const useVsCodeStore = defineStore('vsCode', {
    state: () => ({
        cliStatus: null as ArduinoCLIStatus | null,
        projectInfo: null as ArduinoConfiguration | null,
        projectStatus: null as WebviewToExtensionMessage | null,
        boardConfiguration: null as ArduinoBoardConfigurationPayload | null,
        boards: null as PlatformsList | null,
        platform: null as CorePlatforms | null,
        libraries: null as Libsearch | null,
        librariesInstalled: null as Liblist | null,
        boardUpdating: "",
        libraryUpdating: ""
    }),
    actions: {
        simulateMessage(message: WebviewToExtensionMessage) {
            console.log(message);
            switch (message.command) {
                case ARDUINO_MESSAGES.CORE_SEARCH:
                    const payload = JSON.stringify(mockDataSearchBoards);
                    message.payload = payload;
                    this.handleMessage(message);
                    break;

                default:
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
