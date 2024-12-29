import * as vscode from 'vscode';
import { ARDUINO_ERRORS, ArduinoProjectConfiguration, ArduinoProjectStatus, CompileResult } from './shared/messages';
import { arduinoCLI, arduinoExtensionChannel } from './extension';

const path = require('path');
const fs = require('fs');

export const VSCODE_FOLDER: string = ".vscode";
export const COMPILE_RESULT_FILE: string = "compile_result.json";
const ARDUINO_SETTINGS: string = "arduino.json";
const ARDUINO_SKETCH_EXTENSION: string = ".ino";
const ARDUINO_DEFAULT_OUTPUT: string = "build";

export class ArduinoProject {
    private arduinoConfigurationPath: string = "";
    private configJson: ArduinoProjectConfiguration = { port: "", configuration: "", output: ARDUINO_DEFAULT_OUTPUT, board: "", programmer: "", useProgrammer: false, configurationRequired: false };
    private projectFullPath: string = "";
    private projectStatus: ArduinoProjectStatus = { status: ARDUINO_ERRORS.NO_ERRORS };

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.projectFullPath = workspaceFolders[0].uri.fsPath;
            arduinoExtensionChannel.appendLine(`projectFullPath is ${this.projectFullPath}`)
        } else {
            arduinoExtensionChannel.appendLine(`Problem : cannot get projectFullPath`);
            vscode.window.showErrorMessage('No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder');
        }
    }
    public isUploadReady(): boolean {
        if (this.configJson.port.trim().length !== 0) {
            const resultFile = path.join(this.getProjectPath(), this.getOutput(), COMPILE_RESULT_FILE);
            try {
                const content = fs.readFileSync(resultFile, 'utf-8');
                const result: CompileResult = JSON.parse(content);
                return result.result;
            } catch (error) {
                return false;
            }
        }
        return false;
    }
    public isCompileReady(): boolean {
        if (this.configJson.board.trim().length > 0) {
            if (this.configJson.configurationRequired) {
                return this.configJson.configuration.trim().length > 0;
            }
            return true;
        }
        return false;
    }
    public getStatus(): ArduinoProjectStatus {
        return this.projectStatus;
    }
    public setStatus(status: ARDUINO_ERRORS) {
        this.projectStatus.status = status;
    }
    public getarduinoConfigurationPath(): string {
        return this.arduinoConfigurationPath;
    }
    public readConfiguration(): boolean {
        if (!this.projectFullPath) {
            return false;
        }

        try {
            const vsCodeFolder = path.join(this.projectFullPath, VSCODE_FOLDER);
            if (!fs.existsSync(vsCodeFolder)) {
                fs.mkdirSync(vsCodeFolder);
            }
        } catch (error) {
            arduinoExtensionChannel.appendLine(`Error: Cannot create folder ${VSCODE_FOLDER} in ${this.projectFullPath}`);
        }

        this.arduinoConfigurationPath = path.join(this.projectFullPath, VSCODE_FOLDER, ARDUINO_SETTINGS);
        if (!fs.existsSync(this.arduinoConfigurationPath)) {
            this.writeVSCodeArduinoConfiguration();
        } else {
            try {
                const configContent = fs.readFileSync(this.arduinoConfigurationPath, 'utf-8');
                this.configJson = JSON.parse(configContent);
                if (!this.configJson.configuration) {
                    this.configJson.configuration = "";
                    this.writeVSCodeArduinoConfiguration();
                }
            } catch (error) {
                arduinoExtensionChannel.appendLine(`New ${ARDUINO_SETTINGS} file created`);
                this.writeVSCodeArduinoConfiguration();
            }
        }

        return true;
    }

    public isFolderArduinoProject(): ARDUINO_ERRORS {
        try {
            let error: ARDUINO_ERRORS = ARDUINO_ERRORS.NO_INO_FILES;

            const folderName = path.basename(this.getProjectPath());
            const files = fs.readdirSync(this.getProjectPath());

            for (const file of files) {
                const filePath = path.join(this.getProjectPath(), file);

                if (fs.statSync(filePath).isFile() && path.extname(file).toLowerCase() === ARDUINO_SKETCH_EXTENSION) {
                    const sketchBase = path.basename(file, ARDUINO_SKETCH_EXTENSION);

                    if (sketchBase === folderName) {
                        // this.sketchFileName = sketchBase + ARDUINO_SKETCH_EXTENSION;
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
    public getProjectPath(): string {
        return this.projectFullPath;
    }
    public setBoard(board: string) {
        this.configJson.board = board;
        this.writeVSCodeArduinoConfiguration();
    }
    public setConfiguration(configuration: string) {
        if (configuration !== this.configJson.configuration) {
            // A recompile is necessary if the board configuration is changed
            arduinoCLI.setBuildResult(false);
        }
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
    public getArduinoConfiguration(): ArduinoProjectConfiguration {
        return this.configJson;
    }
    public getPort(): string {
        return this.configJson.port || '';
    }
    public getBoard(): string {
        return this.configJson.board || '';
    }
    public getProgrammer(): string {
        return this.configJson.programmer || '';
    }
    public setProgrammer(programmer: string): void {
        this.configJson.programmer = programmer;
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public useProgrammer(): boolean {
        return this.configJson.useProgrammer || false;
    }
    public setUseProgrammer(use: boolean): void {
        this.configJson.useProgrammer = use;
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public setConfigurationRequired(required: boolean): void {
        this.configJson.configurationRequired = required;
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public isConfigurationRequired(): boolean {
        return this.configJson.configurationRequired || false;
    }
    private setOutput(output: string) {
        this.configJson.output = output;
        this.writeVSCodeArduinoConfiguration();
    }

}
