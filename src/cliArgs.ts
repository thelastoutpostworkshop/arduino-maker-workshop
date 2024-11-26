
const configCommandArduino: string = 'config';
const dumpOption: string = 'dump';
const jsonOutputArduino: string = '--json';
const removeOption: string = 'remove';
const addtionalURLOption: string = '--additional-urls';
const configAdditionnalURLsetting: string = 'board_manager.additional_urls';
const addOption: string = 'add';
const initOption: string = 'init';
const setOption: string = 'set';

export class CLIArguments {
    public getConfigDumpArgs(): string[] {
        const command = [
            `${configCommandArduino}`,
            `${dumpOption}`,
            `${jsonOutputArduino}`
        ];
        return command;
    }
    public getConfigRemoveAdditionalBoardURLArgs(URL: string): string[] {
        const command = [
            `${configCommandArduino}`,
            `${removeOption}`,
            `${configAdditionnalURLsetting}`,
            `${URL}`,
        ];
        return command;
    }
    public getConfigAddAdditionalBoardURLArgs(URL: string): string[] {
        const command = [
            `${configCommandArduino}`,
            `${addOption}`,
            `${configAdditionnalURLsetting}`,
            `${URL}`,
        ];
        return command;
    }
    public getConfigSetAdditionalBoardURLArgs(URL: string): string[] {
        const urls = URL.split(' ');
        const command = [
            `${configCommandArduino}`,
            `${setOption}`,
            `${configAdditionnalURLsetting}`,
            `${urls[0]}`,
            `${urls[1]}`,
        ];
        return command;
    }
    public getConfigInitArgs(): string[] {
        const command = [
            `${configCommandArduino}`,
            `${initOption}`,
            `${jsonOutputArduino}`
        ];
        return command;
    }
}