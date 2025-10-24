import { arduinoProject, arduinoYaml } from "./extension";
import { window, workspace } from 'vscode';
import { DEFAULT_PROFILE, PROFILES_STATUS } from "./shared/messages";

const path = require('path');

const configCommandArduino: string = 'config';
const dumpOption: string = 'dump';
const jsonOutputArduino: string = '--json';
const removeOption: string = 'remove';
const addOption: string = 'add';
const initOption: string = 'init';
const setOption: string = 'set';
const getOption: string = 'get';
const compileCommandArduino: string = 'compile';
const compileCleanOption: string = '--clean';
const dumpProfileOption: string = '--dump-profile';
const profileOption: string = '--profile';
const optimizeForDebugOption: string = '--optimize-for-debug';
const buildPathArduino: string = '--build-path';
const verboseOptionArduino: string = '-v';
const noColorOptionArduino: string = '--no-color';
const fqbnOptionArduino: string = '--fqbn';
const jopsOptionArduino: string = '--jobs';
const uploadCommandArduino: string = 'upload';
const portOptionArduino: string = '-p';
const inputDirOptionArduino: string = '--input-dir';
const preprocessCompileOptionArduino: string = '--preprocess';
const versionCommandArduino: string = 'version';
const sketchCommandArduino: string = 'sketch';
const boardCommandArduino: string = 'board';
const libraryCommandArduino: string = 'lib';
const listFunctionArduino: string = 'list';
const detailsFunctionArduino: string = 'details';
const outdatedCommandArduino: string = 'outdated';
const coreCommandArduino: string = 'core';
const updateOption: string = 'update-index';
const newOption: string = 'new';
const installOption: string = 'install';
const uninstallOption: string = 'uninstall';
const searchOption: string = 'search';
const listOption: string = 'list';
const zipOption: string = '--zip-path';
const programmerOption: string = '-P';

// Config settings
const configAdditionnalURLsetting: string = 'board_manager.additional_urls';
const configDirDataSetting: string = 'directories.data';
const configDirDownloadSetting: string = 'directories.downloads';
const configDirUserSetting: string = 'directories.user';
const configLibrarySetting: string = 'library.enable_unsafe_install';

export class CLIArguments {
    public getVerboseOption(): boolean {
        const config = workspace.getConfiguration('arduinoMakerWorkshop');
        return config.get<boolean>('verboseCompile', true);
    }
    public getConfigSetLibrarySetting(enable: boolean): string[] {
        const command = [
            `${configCommandArduino}`,
            `${setOption}`,
            `${configLibrarySetting}`,
            `${enable}`,
        ];
        return command;
    }
    public getConfigSetDowloadDirectory(dir: string): string[] {
        const command = [
            `${configCommandArduino}`,
            `${setOption}`,
            `${configDirDownloadSetting}`,
            `${dir}`,
        ];
        return command;
    }
    public getConfigSetDataDirectory(dir: string): string[] {
        const command = [
            `${configCommandArduino}`,
            `${setOption}`,
            `${configDirDataSetting}`,
            `${dir}`,
        ];
        return command;
    }
    public getConfigSetUserDirectory(dir: string): string[] {
        const command = [
            `${configCommandArduino}`,
            `${setOption}`,
            `${configDirUserSetting}`,
            `${dir}`,
        ];
        return command;
    }
    public getConfigGetUserDirectory(): string[] {
        const command = [
            `${configCommandArduino}`,
            `${getOption}`,
            `${configDirUserSetting}`
        ];
        return command;
    }
    public getOutdatedArguments(): string[] {
        const outdatedCommand = [
            `${outdatedCommandArduino}`,
            `${jsonOutputArduino}`
        ];
        return outdatedCommand;
    }
    public getNewSketchArguments(name: string): string[] {
        const outdatedCommand = [
            `${sketchCommandArduino}`,
            `${newOption}`,
            `${name}`,
            `${jsonOutputArduino}`
        ];
        return outdatedCommand;
    }
    public getCoreUpdateArguments(): string[] {
        const updateCoreCommand = [
            `${coreCommandArduino}`,
            `${updateOption}`,
        ];
        return updateCoreCommand;
    }
    public getInstallCoreVersionArguments(version: string): string[] {
        const installCoreVersionCommand = [
            `${coreCommandArduino}`,
            `${installOption}`,
            `--run-post-install`,
            `--run-pre-uninstall`,
            `${version}`
        ];
        return installCoreVersionCommand;
    }
    public getInstallLibraryVersionArguments(version: string): string[] {
        const command = [
            `${libraryCommandArduino}`,
            `${installOption}`,
            `${version}`
        ];
        return command;
    }
    public getInstallZipLibrary(zipPath: string): string[] {
        const command = [
            `${libraryCommandArduino}`,
            `${installOption}`,
            `${zipOption}`,
            `${zipPath}`
        ];
        return command;
    }
    public getUninstallLibraryArguments(name: string): string[] {
        const installCoreVersionCommand = [
            `${libraryCommandArduino}`,
            `${uninstallOption}`,
            `${name}`
        ];
        return installCoreVersionCommand;
    }
    public getUninstallCoreArguments(board_id: string): string[] {
        const installCoreVersionCommand = [
            `${coreCommandArduino}`,
            `${uninstallOption}`,
            `--run-post-install`,
            `--run-pre-uninstall`,
            `${board_id}`
        ];
        return installCoreVersionCommand;
    }
    public getPortListArguments(): string[] {
        const compileCommand = [
            `${boardCommandArduino}`,
            `${listFunctionArduino}`,
            `${jsonOutputArduino}`
        ];
        return compileCommand;
    }
    public getVersionArguments(): string[] {
        const versionCommand = [
            `${versionCommandArduino}`,
            `${jsonOutputArduino}`
        ];
        return versionCommand;
    }
    public getBoardsListArguments(): string[] {
        const searchAllCommand = [
            `${boardCommandArduino}`,
            `${searchOption}`,
            `${jsonOutputArduino}`
        ];
        return searchAllCommand;
    }
    public getBoardConnectedArguments(): string[] {
        const command = [
            `${boardCommandArduino}`,
            `${listOption}`,
            `${jsonOutputArduino}`
        ];
        return command;
    }
    public getCoreSearchArguments(): string[] {
        const searchAllCommand = [
            `${coreCommandArduino}`,
            `${searchOption}`,
            `-a`,
            `${jsonOutputArduino}`
        ];
        return searchAllCommand;
    }

    public getLibrarySearchArguments(): string[] {
        const libSearchCommand = [
            `${libraryCommandArduino}`,
            `${searchOption}`,
            `--omit-releases-details`,
            `${jsonOutputArduino}`
        ];
        return libSearchCommand;
    }
    public getLibraryInstalledArguments(): string[] {
        const command = [
            `${libraryCommandArduino}`,
            `${listOption}`,
            `${jsonOutputArduino}`
        ];
        return command;
    }
    public getBoardConfigurationArguments(): string[] {
        let boardConfigArg = "";
        if (arduinoProject.getBoardConfiguration() === "") {
            boardConfigArg = arduinoProject.getBoard();
        } else {
            boardConfigArg = `${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`;
        }
        const compileCommand = [
            `${boardCommandArduino}`,
            `${detailsFunctionArduino}`,
            `${fqbnOptionArduino}`,
            `${boardConfigArg}`,
            `${jsonOutputArduino}`
        ];
        return compileCommand;
    }
    public getProfileBoardConfigurationArguments(fqbn: string): string[] {
        const compileCommand = [
            `${boardCommandArduino}`,
            `${detailsFunctionArduino}`,
            `${fqbnOptionArduino}`,
            `${fqbn}`,
            `${jsonOutputArduino}`
        ];
        return compileCommand;
    }
    public getPreprocessCommandArguments(): string[] {
        const compileCommand = [
            `${compileCommandArduino}`,
            `${verboseOptionArduino}`,
            `${preprocessCompileOptionArduino}`,
            `${fqbnOptionArduino}`,
            `${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`,
            arduinoProject.getProjectPath()
        ];
        return compileCommand;
    }
    public getBuildPath(): string {
        if (arduinoYaml.status() == PROFILES_STATUS.ACTIVE) {
            return path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), arduinoYaml.getBuildFolderProfileName());
        } else {
            return path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput());
        }
    }
    public getUploadArguments(): string[] {
        if (arduinoYaml.status() == PROFILES_STATUS.ACTIVE) {
            // Upload using a profile
            const command = [
                `${uploadCommandArduino}`
            ];
            const profileName = arduinoProject.getCompileProfile();
            if (!profileName) {
                window.showWarningMessage("You must select a profile");
                return [];
            }
            if (profileName !== DEFAULT_PROFILE) {
                command.push(profileOption);
                command.push(profileName);
            }
            command.push(verboseOptionArduino);
            command.push(noColorOptionArduino);
            command.push(`${inputDirOptionArduino}`);
            command.push(this.getBuildPath());
            command.push(arduinoProject.getProjectPath());
            return command;
        }

        // Upload with project configuration
        arduinoProject.readConfiguration();
        const command = [
            `${uploadCommandArduino}`,
            `${verboseOptionArduino}`,
            `${noColorOptionArduino}`,
            `${portOptionArduino}`,
            `${arduinoProject.getPort()}`,
            `${fqbnOptionArduino}`
        ];
        if (arduinoProject.isConfigurationRequired()) {
            command.push(`${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`);
        } else {
            command.push(`${arduinoProject.getBoard()}`);
        }
        if (arduinoProject.useProgrammer()) {
            command.push(programmerOption);
            command.push(arduinoProject.getProgrammer());
        }
        command.push(`${inputDirOptionArduino}`);
        command.push(this.getBuildPath());
        command.push(arduinoProject.getProjectPath());
        return command;
    }
    public getCompileCommandArguments(jsonOutput: boolean = false, clean: boolean = false, configurationRequired: boolean, buildProfile = false): string[] {
        const compileCommand = [
            `${compileCommandArduino}`
        ];

        if (buildProfile) {
            // Compile to create a build profile
            if (this.getVerboseOption()) {
                compileCommand.push(verboseOptionArduino);
            }
            if (arduinoProject.optimizeForDebug()) {
                compileCommand.push(`${optimizeForDebugOption}`);
            }
            compileCommand.push(`${dumpProfileOption}`);
            compileCommand.push(`${jopsOptionArduino}`);
            compileCommand.push("0");
            compileCommand.push(fqbnOptionArduino);
            if (configurationRequired) {
                compileCommand.push(`${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`);
            } else {
                compileCommand.push(`${arduinoProject.getBoard()}`);
            }
            compileCommand.push(`${buildPathArduino}`);
            compileCommand.push(path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput()));
            compileCommand.push(arduinoProject.getProjectPath());
            return compileCommand;
        }

        if (arduinoYaml.status() == PROFILES_STATUS.ACTIVE) {
            // Compile using a profile
            const profileName = arduinoProject.getCompileProfile();
            if (!profileName) {
                window.showWarningMessage("You must select a profile");
                return [];
            }
            if (profileName !== DEFAULT_PROFILE) {
                compileCommand.push(profileOption);
                compileCommand.push(profileName);
            }
            if (this.getVerboseOption()) {
                compileCommand.push(verboseOptionArduino);
            }
            if (arduinoProject.optimizeForDebug()) {
                compileCommand.push(`${optimizeForDebugOption}`);
            }
            compileCommand.push(`${jopsOptionArduino}`);
            compileCommand.push("0");
            compileCommand.push(`${buildPathArduino}`);
            compileCommand.push(this.getBuildPath());
            compileCommand.push(arduinoProject.getProjectPath());
            if (clean) {
                compileCommand.push(`${compileCleanOption}`);
            }
            return compileCommand;
        }

        // Compile with project configuration
        if (this.getVerboseOption()) {
            compileCommand.push(verboseOptionArduino);
        }
        if (arduinoProject.optimizeForDebug()) {
            compileCommand.push(`${optimizeForDebugOption}`);
        }
        compileCommand.push(`${jopsOptionArduino}`);
        compileCommand.push("0");
        compileCommand.push(fqbnOptionArduino);
        if (configurationRequired) {
            compileCommand.push(`${arduinoProject.getBoard()}:${arduinoProject.getBoardConfiguration()}`);
        } else {
            compileCommand.push(`${arduinoProject.getBoard()}`);
        }
        compileCommand.push(`${buildPathArduino}`);
        compileCommand.push(path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput()));
        compileCommand.push(arduinoProject.getProjectPath());
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
