import * as vscode from 'vscode';
import type { Dirent } from 'node:fs';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoProjectConfiguration, ArduinoProjectStatus, CompileResult, PROFILES_STATUS } from './shared/messages';
import { arduinoCLI, arduinoExtensionChannel, arduinoProject, arduinoYaml, updateStateCompileUpload } from './extension';
import { LineEnding, MonitorPortSettings, Parity, StopBits } from '@microsoft/vscode-serial-monitor-api';
import { VueWebviewPanel } from './VueWebviewPanel';

const path = require('path');
const fs = require('fs');

export const VSCODE_FOLDER: string = ".vscode";
export const COMPILE_RESULT_FILE: string = "compile_result.json";
const ARDUINO_SETTINGS: string = "arduino.json";
export const ARDUINO_SKETCH_EXTENSION: string = ".ino";
const ARDUINO_DEFAULT_OUTPUT: string = "build";
const ARDUINO_CONFIGURATION_SCHEMA_VERSION: number = 1;
const SOURCE_EXTENSIONS = ['.ino', '.cpp', '.h', '.hpp', '.c', '.cc', '.cxx'];

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

function getArduinoProjectConfigurationDefault(): ArduinoProjectConfiguration {
    return {
        schemaVersion: ARDUINO_CONFIGURATION_SCHEMA_VERSION,
        port: "", configuration: "", output: ARDUINO_DEFAULT_OUTPUT, board: "", programmer: "", useProgrammer: false,
        optimize_for_debug: false, configurationRequired: false, compile_profile: "",
        monitorPortSettings: getMonitorPortSettingsDefault()
    };
}

export class ArduinoProject {
    private configJson: ArduinoProjectConfiguration = getArduinoProjectConfigurationDefault();
    private arduinoConfigurationPath: string = "";
    private projectFullPath: string = "";
    private projectStatus: ArduinoProjectStatus = { status: ARDUINO_ERRORS.NO_ERRORS };

    constructor() {
        if (this.updateProjectPathFromWorkspace()) {
            arduinoExtensionChannel.appendLine(`Workspace is ${this.projectFullPath}`)
        } else {
            arduinoExtensionChannel.appendLine(`No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder`);
            vscode.window.showErrorMessage('No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder');
        }
    }

    private updateProjectPathFromWorkspace(): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.configJson = getArduinoProjectConfigurationDefault();
            this.projectFullPath = "";
            this.arduinoConfigurationPath = "";
            return false;
        }

        const projectPath = workspaceFolders[0].uri.fsPath;
        if (projectPath !== this.projectFullPath) {
            this.configJson = getArduinoProjectConfigurationDefault();
        }
        this.projectFullPath = projectPath;
        this.arduinoConfigurationPath = path.join(projectPath, VSCODE_FOLDER, ARDUINO_SETTINGS);
        return true;
    }

    public isUploadReady(): UPLOAD_READY_STATUS {
        if (arduinoYaml.status() !== PROFILES_STATUS.ACTIVE && this.configJson.port.trim().length == 0) {
            return UPLOAD_READY_STATUS.NO_PORT;
        }

        const resultFile = path.join(arduinoCLI.getBuildPath(), COMPILE_RESULT_FILE);
        try {
            const content = fs.readFileSync(resultFile, 'utf-8');
            const result: CompileResult = JSON.parse(content);
            if (result.result) {
                if (this.isBuildOutOfDate(resultFile)) {
                    return UPLOAD_READY_STATUS.LAST_COMPILE_FAILED;
                }
                return UPLOAD_READY_STATUS.READY;
            } else {
                return UPLOAD_READY_STATUS.LAST_COMPILE_FAILED
            }
        } catch (error) {
            return UPLOAD_READY_STATUS.LAST_COMPILE_FAILED;
        }

    }
    public isCompileReady(): boolean {
        if(arduinoYaml.status() === PROFILES_STATUS.ACTIVE && arduinoProject.getCompileProfile()) {
            return true;
        }
        if (this.configJson.board.trim().length > 0) {
            if (this.configJson.configurationRequired) {
                return this.configJson.configuration.trim().length > 0;
            }
            return true;
        }
        return false;
    }
    public getStatus(): ArduinoProjectStatus {
        this.projectStatus.status = this.isFolderArduinoProject();
        this.projectStatus.cli_status = arduinoCLI.getCLIStatus();
        return this.projectStatus;
    }

    private isBuildOutOfDate(resultFile: string): boolean {
        try {
            const buildTime = fs.statSync(resultFile).mtimeMs;
            const latestSourceTime = this.getLatestSourceMtime();
            return latestSourceTime > buildTime;
        } catch (error) {
            return true;
        }
    }

    private getLatestSourceMtime(): number {
        const root = this.getProjectPath();
        const outputDir = path.join(root, this.getOutput());
        const ignoredNames = new Set([".git", ".vscode", "node_modules"]);
        let latest = 0;
        const stack = [root];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }
            let entries: Dirent[];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch (error) {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (fullPath.startsWith(outputDir + path.sep)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    if (ignoredNames.has(entry.name)) {
                        continue;
                    }
                    stack.push(fullPath);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
                    continue;
                }
                try {
                    const mtime = fs.statSync(fullPath).mtimeMs;
                    if (mtime > latest) {
                        latest = mtime;
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        return latest;
    }
    public setStatus(status: ARDUINO_ERRORS) {
        this.projectStatus.status = status;
    }
    public getarduinoConfigurationPath(): string {
        return this.arduinoConfigurationPath;
    }
    public readConfiguration(): boolean {
        // Always replace the previous snapshot, including when a file was removed
        // or is temporarily malformed during an external edit.
        this.configJson = getArduinoProjectConfigurationDefault();
        if (!this.updateProjectPathFromWorkspace()) {
            return false;
        }

        if (!fs.existsSync(this.arduinoConfigurationPath)) {
            return true;
        }

        try {
            const configContent = fs.readFileSync(this.arduinoConfigurationPath, 'utf-8');
            const config = JSON.parse(configContent);
            if (!config || typeof config !== 'object' || Array.isArray(config)) {
                throw new Error('Configuration must be an object.');
            }

            const defaults = getArduinoProjectConfigurationDefault();
            for (const key of ['port', 'configuration', 'output', 'board', 'programmer', 'compile_profile']) {
                if (config[key] !== undefined && typeof config[key] !== 'string') {
                    throw new Error(`Invalid configuration field: ${key}.`);
                }
            }
            for (const key of ['useProgrammer', 'optimize_for_debug', 'configurationRequired']) {
                if (config[key] !== undefined && typeof config[key] !== 'boolean') {
                    throw new Error(`Invalid configuration field: ${key}.`);
                }
            }
            if (config.schemaVersion !== undefined && typeof config.schemaVersion !== 'number') {
                throw new Error('Invalid configuration field: schemaVersion.');
            }

            // Normalize legacy files in memory. Only explicit setters persist a
            // migration, so inspection cannot overwrite externally edited files.
            const monitor = config.schemaVersion === undefined && config.monitorPortSettings?.settings !== undefined
                ? config.monitorPortSettings.settings : config.monitorPortSettings;
            if (monitor !== undefined && (!monitor || typeof monitor !== 'object' || Array.isArray(monitor))) {
                throw new Error('Invalid configuration field: monitorPortSettings.');
            }
            for (const key of ['port', 'lineEnding', 'parity', 'stopBits']) {
                if (monitor?.[key] !== undefined && typeof monitor[key] !== 'string') {
                    throw new Error(`Invalid monitor configuration field: ${key}.`);
                }
            }
            for (const key of ['baudRate', 'dataBits']) {
                if (monitor?.[key] !== undefined && typeof monitor[key] !== 'number') {
                    throw new Error(`Invalid monitor configuration field: ${key}.`);
                }
            }
            this.configJson = {
                ...defaults,
                ...config,
                monitorPortSettings: {
                    ...defaults.monitorPortSettings,
                    port: config.port ?? '',
                    ...monitor
                }
            };
            return true;
        } catch (error) {
            arduinoExtensionChannel.appendLine(`Cannot read ${ARDUINO_SETTINGS}; the file was left unchanged.`);
            return false;
        }
    }

    public isFolderArduinoProject(): ARDUINO_ERRORS {
        delete this.projectStatus.folderName;
        delete this.projectStatus.sketchName;

        if (!this.updateProjectPathFromWorkspace()) {
            return ARDUINO_ERRORS.NO_WORKSPACE;
        }

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
                // console.warn(`Skipping file ${file}:`, err);
                continue; // skip problematic file
            }
        }

        return error;
    }


    public setPort(port: string): void {
        this.configJson.port = port;
        this.configJson.monitorPortSettings.port = port;
        VueWebviewPanel.sendMessage({
            command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO,
            errorMessage: "",
            payload: this.configJson
        });
        this.writeVSCodeArduinoConfiguration();
    }

    public getMonitorPortSettings(): MonitorPortSettings {
        return this.configJson.monitorPortSettings;
    }

    public setMonitorPortSettings(monitorPortSettings: MonitorPortSettings) {
        // arduinoExtensionChannel.appendLine(`New monitor port settings applied: $${JSON.stringify(monitorPortSettings)}`)
        this.configJson.monitorPortSettings = monitorPortSettings;
        this.writeVSCodeArduinoConfiguration();
    }

    public updateBoardConfiguration(newConfig: string): void {
        this.configJson.configuration = newConfig;
        this.writeVSCodeArduinoConfiguration();
    }

    private writeVSCodeArduinoConfiguration() {
        if (!this.projectFullPath || !this.arduinoConfigurationPath) {
            return;
        }
        fs.mkdirSync(path.dirname(this.arduinoConfigurationPath), { recursive: true });
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
        // arduinoExtensionChannel.appendLine(`Wrote configuration to ${this.arduinoConfigurationPath}`);
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
        this.setUseProgrammer(false);
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
    public optimizeForDebug(): boolean {
        return this.configJson.optimize_for_debug || false;
    }
    public setUseProgrammer(use: boolean): void {
        this.configJson.useProgrammer = use;
        this.writeVSCodeArduinoConfiguration();
    }
    public setCompileProfile(profile: string): void {
        this.configJson.compile_profile = profile;
        this.writeVSCodeArduinoConfiguration();
        VueWebviewPanel.sendMessage({
            command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO,
            errorMessage: "",
            payload: this.configJson
        })
        updateStateCompileUpload();
    }
    public getCompileProfile(): string {
        return this.configJson.compile_profile || '';
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
