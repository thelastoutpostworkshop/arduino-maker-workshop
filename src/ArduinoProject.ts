import * as vscode from 'vscode';
import { ARDUINO_ERRORS, ArduinoConfiguration } from './shared/messages';

const path = require('path');
const fs = require('fs');

export const compileCommandArduino: string = 'compile';
const versionCommandArduino: string = 'version';
const sketchCommandArduino: string = 'sketch';
const uploadCommandArduino: string = 'upload';
const boardCommandArduino: string = 'board';
const libraryCommandArduino: string = 'lib';
const listFunctionArduino: string = 'list';
const listAllFunctionArduino: string = 'listall';
const detailsFunctionArduino: string = 'details';
const jsonOutputArduino: string = '--json';
const outdatedCommandArduino: string = 'outdated';
const coreCommandArduino: string = 'core';
const updateOption: string = 'update-index';
const newOption: string = 'new';
const installOption: string = 'install';
const uninstallOption: string = 'uninstall';
const searchOption: string = 'search';
const listOption: string = 'list';
const addtionalURLOption: string = '--additional-urls';
export const verboseOptionArduino: string = '-v';
export const portOptionArduino: string = '-p';
export const buildPathArduino: string = '--build-path';
export const jobsOptionArduino: string = '--jobs';
export const fqbnOptionArduino: string = '--fqbn';
export const inputDirOptionArduino: string = '--input-dir';
export const noColorOptionArduino: string = '--no-color';
export const preprocessCompileOptionArduino: string = '--preprocess';

const CPP_PROPERTIES: string = "c_cpp_properties.json";
const VSCODE_FOLDER: string = ".vscode";
const ARDUINO_SETTINGS: string = "arduino.json";
const ARDUINO_SKETCH_EXTENSION: string = ".ino";
const ARDUINO_DEFAULT_OUTPUT: string = "build";

export class ArduinoProject {
    private arduinoConfigurationPath: string = "";
    private configJson: ArduinoConfiguration = { port: "", configuration: "", output: ARDUINO_DEFAULT_OUTPUT, board: "" };
    private projectFullPath: string = "";
    private additionnlBoardURLs: string = "";

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.projectFullPath = workspaceFolders[0].uri.fsPath;
        }
    }
    private addAdditionalBoardURLs(commandArray: string[]): void {
        // Only add these if additionnlBoardURLs is not empty
        if (this.additionnlBoardURLs && this.additionnlBoardURLs.trim() !== '') {
            commandArray.push(`${addtionalURLOption}`);
            commandArray.push(`${this.additionnlBoardURLs}`);
        }
    }
    public readConfiguration(): boolean {
        if (!this.projectFullPath) {
            return false;
        }

        const vsCodeFolder = path.join(this.projectFullPath, VSCODE_FOLDER);
        if (!fs.existsSync(vsCodeFolder)) {
            fs.mkdirSync(vsCodeFolder);
        }

        this.arduinoConfigurationPath = path.join(this.projectFullPath, VSCODE_FOLDER, ARDUINO_SETTINGS);
        if (!fs.existsSync(this.arduinoConfigurationPath)) {
            this.writeVSCodeArduinoConfiguration();
        } else {
            try {
                const configContent = fs.readFileSync(this.arduinoConfigurationPath, 'utf-8');
                this.configJson = JSON.parse(configContent);
            } catch (error) {
                this.writeVSCodeArduinoConfiguration();
            }
        }

        return true;
    }
    public getCompileCommandArguments(): string[] {
        const compileCommand = [
            `${compileCommandArduino}`,
            `${verboseOptionArduino}`,
            `${noColorOptionArduino}`,
            `${fqbnOptionArduino}`,
            `${this.getBoard()}:${this.getBoardConfiguration()}`,
            `${buildPathArduino}`,
            this.getProjectPath() + '/' + this.getOutput(),
            this.getProjectPath()
        ];
        return compileCommand;
    }
    public getPreprocessCommandArguments(): string[] {
        const compileCommand = [
            `${compileCommandArduino}`,
            `${verboseOptionArduino}`,
            `${preprocessCompileOptionArduino}`,
            `${noColorOptionArduino}`,
            `${fqbnOptionArduino}`,
            `${this.getBoard()}:${this.getBoardConfiguration()}`,
            this.getProjectPath()
        ];
        return compileCommand;
    }
    public getUploadArguments(): string[] {
        this.readConfiguration();
        const compileCommand = [
            `${uploadCommandArduino}`,
            `${verboseOptionArduino}`,
            `${noColorOptionArduino}`,
            `${portOptionArduino}`,
            `${this.getPort()}`,
            `${fqbnOptionArduino}`,
            `${this.getBoard()}:${this.getBoardConfiguration()}`,
            `${inputDirOptionArduino}`,
            this.getProjectPath() + '/' + this.getOutput(),
            this.getProjectPath()
        ];
        return compileCommand;
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
        this.addAdditionalBoardURLs(updateCoreCommand);
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
        this.addAdditionalBoardURLs(searchAllCommand);
        return searchAllCommand;
    }
    public getBoardConnected(): string[] {
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
        this.addAdditionalBoardURLs(searchAllCommand);
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
        if (this.getBoardConfiguration() === "") {
            boardConfigArg = this.getBoard();
        } else {
            boardConfigArg = `${this.getBoard()}:${this.getBoardConfiguration()}`;
        }
        const compileCommand = [
            `${boardCommandArduino}`,
            `${detailsFunctionArduino}`,
            `${fqbnOptionArduino}`,
            // `${this.getBoard()}:${this.getBoardConfiguration()}`,
            `${boardConfigArg}`,
            `${jsonOutputArduino}`
        ];
        return compileCommand;
    }
    public isFolderArduinoProject(): ARDUINO_ERRORS {
        try {
            let error: ARDUINO_ERRORS = ARDUINO_ERRORS.NO_INO_FILES;

            const folderName = path.basename(this.getProjectPath());
            const files = fs.readdirSync(this.getProjectPath());

            for (const file of files) {
                const filePath = path.join(this.getProjectPath(), file);

                if (fs.statSync(filePath).isFile() && path.extname(file).toLowerCase() === ARDUINO_SKETCH_EXTENSION) {
                    const sketchFileName = path.basename(file, ARDUINO_SKETCH_EXTENSION);

                    if (sketchFileName === folderName) {
                        error = ARDUINO_ERRORS.NO_ERRORS;
                        break;
                    } else {
                        error = ARDUINO_ERRORS.WRONG_FOLDER_NAME;
                    }
                }
            }

            return error;
        } catch (error) {
            console.error('Error reading folder:', error);
            return ARDUINO_ERRORS.INTERNAL;
        }
    }


    public generateCppPropertiesFromCompileOutput(output: string) {
        const defines: string[] = [];

        // Regular expressions to match include paths and defines
        const defineRegex = /-D([^\s]+)/g;
        const includeRegex = /"-I([^"]+)"/g;

        const includePaths = new Set();

        let match;

        while ((match = includeRegex.exec(output)) !== null) {
            let path = match[1]; // Capture the path inside the quotes

            // Normalize the path (handle backslashes, especially on Windows)
            path = path.replace(/\\\\/g, "\\"); // Convert backslashes to forward slashes for consistency

            includePaths.add(path + "\\**"); // Use a Set to avoid duplicates
        }

        while ((match = defineRegex.exec(output)) !== null) {
            defines.push(match[1]);
        }

        includePaths.add(this.getProjectPath() + "\\**");
        try {
            const includeDataPath = path.join(this.getProjectPath(), this.getOutput(), "includes.cache");
            const includeData = JSON.parse(fs.readFileSync(includeDataPath, 'utf8'));
            includeData.forEach((entry: any) => {
                if (entry.Includepath) {
                    includePaths.add(entry.Includepath + "\\**");
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage('Cannot generate IntelliSense includes.cache not found');
            return;
        }

        // Create c_cpp_properties.json
        const cppProperties = {
            configurations: [{
                name: "Arduino",
                includePath: Array.from(includePaths),
                defines: defines,
                // compilerPath: "/path/to/compiler",  // You can retrieve this from output if needed
                cStandard: "c11",
                cppStandard: "c++17",
                intelliSenseMode: "gcc-x86"
            }],
            version: 4
        };

        const cppPropertiesPath = path.join(this.getProjectPath(), VSCODE_FOLDER, CPP_PROPERTIES);
        fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));

        vscode.window.showInformationMessage('Generated c_cpp_properties.json for IntelliSense.');
    }
    public setAdditionalBoardURLs(urls: string) {
        this.additionnlBoardURLs = urls;
    }
    public setPort(port: string): void {
        this.configJson.port = port;
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public updateBoardConfiguration(newConfig: string): void {
        this.configJson.configuration = newConfig;
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }

    private writeVSCodeArduinoConfiguration() {
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public getAdditionalBoardURLs(): string {
        return this.additionnlBoardURLs;
    }
    private getProjectPath(): string {
        return this.projectFullPath;
    }
    public setBoard(board: string) {
        this.configJson.board = board;
        this.writeVSCodeArduinoConfiguration();
    }
    public setConfiguration(configuration: string) {
        this.configJson.configuration = configuration;
        this.writeVSCodeArduinoConfiguration();
    }
    public getOutput(): string {
        return this.configJson.output || ARDUINO_DEFAULT_OUTPUT;
    }
    public getBoardConfiguration(): string {
        return this.configJson.configuration || '';
    }
    public resetBoardConfiguration() {
        this.configJson.configuration = "";
        this.writeVSCodeArduinoConfiguration();
    }
    public getArduinoConfiguration(): ArduinoConfiguration {
        return this.configJson;
    }
    public getPort(): string {
        return this.configJson.port || '';
    }
    public getBoard(): string {
        return this.configJson.board || '';
    }

    private setOutput(output: string) {
        this.configJson.output = output;
        this.writeVSCodeArduinoConfiguration();
    }

}
