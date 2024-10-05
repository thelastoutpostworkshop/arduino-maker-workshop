import { defineStore } from 'pinia';
import { MESSAGE_COMMANDS } from '@shared/messages';

export const useVsCodeStore = defineStore('vsCode', {
  state: () => ({
    cliStatus: null as string | null,
    projectInfo: null as any,
    projectStatus: null as any,
  }),
  actions: {
    handleMessage(message: any) {
      switch (message.command) {
        case MESSAGE_COMMANDS.ARDUINO_CLI_STATUS:
          this.cliStatus = message.payload;
          break;
        case MESSAGE_COMMANDS.ARDUINO_PROJECT_INFO:
          this.projectInfo = message.payload;
          break;
        case MESSAGE_COMMANDS.ARDUINO_PROJECT_STATUT:
          this.projectStatus = message.payload;
          break;
        default:
          console.warn('Unknown command received:', message.command);
      }
    },
  },
});
