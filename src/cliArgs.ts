import { arduinoProject } from "./extension";

const configCommandArduino: string = 'config';
const dumpOption: string = 'dump';
const jsonOutputArduino: string = '--json';
const removeOption: string = 'remove';
const addtionalURLOption: string = '--additional-urls';
const configAdditionnalURLsetting: string = 'board_manager.additional_urls';
const addOption: string = 'add';
const initOption: string = 'init';
const setOption: string = 'set';
const compileCommandArduino: string = 'compile';
const compileCleanOption: string = '--clean';
const buildPathArduino: string = '--build-path';
const jobsOptionArduino: string = '--jobs';
const verboseOptionArduino: string = '-v';
const noColorOptionArduino: string = '--no-color';
const fqbnOptionArduino: string = '--fqbn';
const uploadCommandArduino: string = 'upload';
const portOptionArduino: string = '-p';
const inputDirOptionArduino: string = '--input-dir';
const preprocessCompileOptionArduino: string = '--preprocess';

export class CLIArguments {
    public getPreprocessCommandArguments(): string[] {
        const compileCommand = [
            `${compileCommandArduino}`,
            `${verboseOptionArduino}`,
            `${preprocessCompileOptionArduino}`,
            `${noColorOptionArduino}`,
            `${fqbnOptionArduino}`,
            `${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`,
            arduinoProject.getProjectPath()
        ];
        return compileCommand;
    }
    public getUploadArguments(): string[] {
        arduinoProject.readConfiguration();
        const compileCommand = [
            `${uploadCommandArduino}`,
            `${verboseOptionArduino}`,
            `${noColorOptionArduino}`,
            `${portOptionArduino}`,
            `${arduinoProject.getPort()}`,
            `${fqbnOptionArduino}`,
            `${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`,
            `${inputDirOptionArduino}`,
            arduinoProject.getProjectPath() + '/' + arduinoProject.getOutput(),
            arduinoProject.getProjectPath()
        ];
        return compileCommand;
    }
    public getCompileCommandArguments(jsonOutput: boolean = false, clean: boolean = false): string[] {
        const compileCommand = [
            `${compileCommandArduino}`,
            `${verboseOptionArduino}`,
            `${noColorOptionArduino}`,
            `${fqbnOptionArduino}`,
            `${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`,
            `${buildPathArduino}`,
            arduinoProject.getProjectPath() + '\\' + arduinoProject.getOutput(),
            arduinoProject.getProjectPath()
        ];
        if (jsonOutput) {
            compileCommand.push(`${jsonOutputArduino}`);
        }
        if (clean) {
            compileCommand.push(`${compileCleanOption}`);
        }
        return compileCommand;
    }
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