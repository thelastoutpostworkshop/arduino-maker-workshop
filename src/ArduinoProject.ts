import * as vscode from 'vscode';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoProjectConfiguration, ArduinoProjectStatus, CompileResult } from './shared/messages';
import { arduinoCLI, arduinoExtensionChannel } from './extension';
import { LineEnding, MonitorPortSettings, Parity, StopBits } from '@microsoft/vscode-serial-monitor-api';
import { VueWebviewPanel } from './VueWebviewPanel';

const path = require('path');
const fs = require('fs');

export const VSCODE_FOLDER: string = ".vscode";
export const COMPILE_RESULT_FILE: string = "compile_result.json";
const ARDUINO_SETTINGS: string = "arduino.json";
export const ARDUINO_SKETCH_EXTENSION: string = ".ino";
const ARDUINO_DEFAULT_OUTPUT: string = "build";

export enum UPLOAD_READY_STATUS {
    READY,
    NO_PORT,
    LAST_COMPILE_FAILED,
    UNKNOWN
}

export function getMonitorPortSettingsDefault(): MonitorPortSettings {
    return {
        port: "", baudRate: 115200, lineEnding: LineEnding.CRLF, dataBits: 8, parity: Parity.None, stopBits: StopBits.One
    };
}

export class ArduinoProject {
    private configJson: ArduinoProjectConfiguration;
    private arduinoConfigurationPath: string = "";
    private projectFullPath: string = "";
    private projectStatus: ArduinoProjectStatus = { status: ARDUINO_ERRORS.NO_ERRORS };

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.projectFullPath = workspaceFolders[0].uri.fsPath;
            arduinoExtensionChannel.appendLine(`Workspace is ${this.projectFullPath}`)
        } else {
            arduinoExtensionChannel.appendLine(`No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder`);
            vscode.window.showErrorMessage('No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder');
        }
        this.configJson = {
            port: "", configuration: "", output: ARDUINO_DEFAULT_OUTPUT, board: "", programmer: "", useProgrammer: false, optimize_for_debug: false, configurationRequired: false,
            monitorPortSettings: getMonitorPortSettingsDefault()
        };
    }
    public isUploadReady(): UPLOAD_READY_STATUS {
        if (this.configJson.port.trim().length !== 0) {
            const resultFile = path.join(this.getProjectPath(), this.getOutput(), COMPILE_RESULT_FILE);
            try {
                const content = fs.readFileSync(resultFile, 'utf-8');
                const result: CompileResult = JSON.parse(content);
                if (result.result) {
                    return UPLOAD_READY_STATUS.READY
                } else {
                    return UPLOAD_READY_STATUS.LAST_COMPILE_FAILED
                }
            } catch (error) {
                return UPLOAD_READY_STATUS.LAST_COMPILE_FAILED;
            }
        }
        return UPLOAD_READY_STATUS.NO_PORT;
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
                let configJson = JSON.parse(configContent);

                if (configJson.monitorPortSettings === undefined) {
                    configJson.monitorPortSettings = getMonitorPortSettingsDefault();
                    if (configJson.port.trim().length !== 0) {
                        configJson.monitorPortSettings.port = configJson.port;
                    }
                }

                if(configJson.optimize_for_debug == undefined) {
                    configJson.optimize_for_debug = false;
                }

                this.configJson = configJson;
                this.writeVSCodeArduinoConfiguration();

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
        let error: ARDUINO_ERRORS = ARDUINO_ERRORS.NO_INO_FILES;

        const folderName = path.basename(this.getProjectPath());
        const files = fs.readdirSync(this.getProjectPath());

        for (const file of files) {
            const filePath = path.join(this.getProjectPath(), file);

            try {
                if (fs.statSync(filePath).isFile() && path.extname(file).toLowerCase() === ARDUINO_SKETCH_EXTENSION) {
                    const sketchBase = path.basename(file, ARDUINO_SKETCH_EXTENSION);

                    if (sketchBase === folderName) {
                        return ARDUINO_ERRORS.NO_ERRORS;
                    } else {
                        this.projectStatus.sketchName = sketchBase;
                        this.projectStatus.folderName = folderName;
                        error = ARDUINO_ERRORS.WRONG_FOLDER_NAME;
                    }
                }
            } catch (err) {
                console.warn(`Skipping file ${file}:`, err);
                continue; // skip problematic file
            }
        }

        return error;
    }


    public setPort(port: string): void {
        this.configJson.port = port;
        if (this.configJson.monitorPortSettings.port.trim().length === 0) {
            arduinoExtensionChannel.appendLine(`Monitor port is empty. Default to ${this.configJson.port}`);
            this.configJson.monitorPortSettings.port = this.configJson.port;
            VueWebviewPanel.sendMessage({
                command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO,
                errorMessage: "",
                payload: this.configJson
            })
        }
        this.writeVSCodeArduinoConfiguration();
    }

    public getMonitorPortSettings(): MonitorPortSettings {
        return this.configJson.monitorPortSettings;
    }

    public setMonitorPortSettings(monitorPortSettings: MonitorPortSettings) {
        arduinoExtensionChannel.appendLine(`New monitor port settings applied: $${JSON.stringify(monitorPortSettings)}`)
        this.configJson.monitorPortSettings = monitorPortSettings;
        this.writeVSCodeArduinoConfiguration();
    }

    public updateBoardConfiguration(newConfig: string): void {
        this.configJson.configuration = newConfig;
        this.writeVSCodeArduinoConfiguration();
    }

    private writeVSCodeArduinoConfiguration() {
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
        arduinoExtensionChannel.appendLine(`Wrote configuration to ${this.arduinoConfigurationPath}`);
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
        this.writeVSCodeArduinoConfiguration();
    }
    public useProgrammer(): boolean {
        return this.configJson.useProgrammer || false;
    }
    public setUseProgrammer(use: boolean): void {
        this.configJson.useProgrammer = use;
        this.writeVSCodeArduinoConfiguration();
    }
    public setOptimizeForDebug(optimize: boolean): void {
        this.configJson.optimize_for_debug = optimize;
        this.writeVSCodeArduinoConfiguration();
    }
    public setConfigurationRequired(required: boolean): void {
        this.configJson.configurationRequired = required;
        this.writeVSCodeArduinoConfiguration();
    }
    public isConfigurationRequired(): boolean {
        return this.configJson.configurationRequired || false;
    }
    private setOutput(output: string) {
        this.configJson.output = output;
        this.writeVSCodeArduinoConfiguration();
    }

}
