import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, ArduinoProjectInfoPayload, WebviewToExtensionMessage } from '@shared/messages';

export const useVsCodeStore = defineStore('vsCode', {
    state: () => ({
        cliStatus: null as WebviewToExtensionMessage | null,
        projectInfo: null as ArduinoProjectInfoPayload | null,
        projectStatus: null as WebviewToExtensionMessage | null,
        boardConfiguration: null as WebviewToExtensionMessage | null,
    }),
    actions: {
        handleMessage(message: any) {
            switch (message.command) {
                case ARDUINO_MESSAGES.CLI_STATUS:
                    this.cliStatus = message;
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                    try {
                        this.projectInfo = {
                            errorMessage:message.errorMessage,
                            configuration:message.payload.configuration,
                            board:message.payload.board,
                            sketch:message.payload.sketch,
                            output:message.payload.output,
                            port:message.payload.port
                        }
                    } catch (error) {
                        return "Failed to parse Project Configuration information.";
                    }
                    this.projectInfo = message;
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    this.projectStatus = message;
                    break;
                case ARDUINO_MESSAGES.BOARD_CONFIGURATION:
                    this.boardConfiguration = message;
                    break;
                default:
                    console.warn('Unknown command received:', message.command);
            }
        },
    },
});
