import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, ArduinoBoardConfigurationPayload, ArduinoBoardsListPayload, ArduinoCLIStatusPayload, ArduinoProjectInfoPayload, WebviewToExtensionMessage } from '@shared/messages';

export const useVsCodeStore = defineStore('vsCode', {
    state: () => ({
        cliStatus: null as ArduinoCLIStatusPayload | null,
        projectInfo: null as ArduinoProjectInfoPayload | null,
        projectStatus: null as WebviewToExtensionMessage | null,
        boardConfiguration: null as ArduinoBoardConfigurationPayload | null,
        boards:null as ArduinoBoardsListPayload | null,
    }),
    actions: {
        handleMessage(message: WebviewToExtensionMessage) {
            switch (message.command) {
                case ARDUINO_MESSAGES.CLI_STATUS:
                    if (message.errorMessage !== "") {
                        this.cliStatus = {
                            errorMessage: message.errorMessage,
                            version: "",
                            date: ""
                        }
                    } else {
                        try {
                            const cliInfo = JSON.parse(message.payload);
                            this.cliStatus = {
                                errorMessage: message.errorMessage,
                                version: cliInfo.VersionString,
                                date: cliInfo.Date
                            }
                        } catch (error) {
                            return "Failed to parse Arduino CLI Status.";
                        }
                    }
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                    try {
                        this.projectInfo = {
                            errorMessage: message.errorMessage,
                            configuration: message.payload.configuration,
                            board: message.payload.board,
                            sketch: message.payload.sketch,
                            output: message.payload.output,
                            port: message.payload.port
                        }
                    } catch (error) {
                        return "Failed to parse Project Configuration information.";
                    }
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    this.projectStatus = message;
                    break;
                case ARDUINO_MESSAGES.BOARD_CONFIGURATION:
                    try {
                        this.boardConfiguration = {
                            errorMessage: message.errorMessage,
                            configuration: message.payload.configuration,
                            boardName: message.payload.boardName
                        };
                    } catch (error) {
                        return "Failed to parse Board Configuration information.";
                    }
                    break;
                case ARDUINO_MESSAGES.BOARDS_LIST_ALL:
                    try {
                        this.boards = {
                            errorMessage: message.errorMessage,
                            configuration: message.payload.configuration,
                            boardName: message.payload.boardName
                        };
                    } catch (error) {
                        return "Failed to parse Board Configuration information.";
                    }
                    break;
                default:
                    console.warn('Unknown command received:', message.command);
            }
        },
    },
});
