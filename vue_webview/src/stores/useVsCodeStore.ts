import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, WebviewToExtensionMessage } from '@shared/messages';

export const useVsCodeStore = defineStore('vsCode', {
    state: () => ({
        cliStatus: null as WebviewToExtensionMessage | null,
        projectInfo: null as any,
        projectStatus: null as any,
    }),
    actions: {
        handleMessage(message: any) {
            switch (message.command) {
                case ARDUINO_MESSAGES.CLI_STATUS:
                    this.cliStatus = message;
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                    this.projectInfo = message;
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    this.projectStatus = message;
                    break;
                default:
                    console.warn('Unknown command received:', message.command);
            }
        },
    },
});
