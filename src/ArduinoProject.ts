import * as vscode from 'vscode';
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
const SKETCH_SEARCH_MAX_DEPTH = 5;
const SKETCH_IGNORE_FOLDERS = new Set(['.git', 'node_modules', 'build', 'dist', 'out', '.vscode']);

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
    private workspaceRootPaths: string[] = [];
    private activeSketchPath: string = "";
    private projectStatus: ArduinoProjectStatus = { status: ARDUINO_ERRORS.NO_ERRORS };
    private workspaceState?: vscode.Memento;

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.workspaceRootPaths = workspaceFolders.map((folder) => folder.uri.fsPath);
            this.projectFullPath = this.workspaceRootPaths[0] ?? "";
            arduinoExtensionChannel.appendLine(`Workspace is ${this.projectFullPath}`)
        } else {
            arduinoExtensionChannel.appendLine(`No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder`);
            vscode.window.showErrorMessage('No workspace available, open a workspace by using the File > Open Folder... menu, and then selecting a folder');
        }
        this.configJson = {
            port: "", configuration: "", output: ARDUINO_DEFAULT_OUTPUT, board: "", programmer: "", useProgrammer: false,
            optimize_for_debug: false, configurationRequired: false, compile_profile: "",
            monitorPortSettings: getMonitorPortSettingsDefault()
        };
    }
    public setWorkspaceState(state: vscode.Memento) {
        this.workspaceState = state;
        const storedPath = state.get<string>('activeSketchPath');
        if (storedPath && this.isValidSketchFolder(storedPath)) {
            this.setActiveSketchPath(storedPath, false);
        }
    }
    public getActiveSketchPath(): string {
        return this.activeSketchPath || this.projectFullPath;
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
                return UPLOAD_READY_STATUS.READY
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
    public setStatus(status: ARDUINO_ERRORS) {
        this.projectStatus.status = status;
    }
    public getarduinoConfigurationPath(): string {
        return this.arduinoConfigurationPath;
    }
    public readConfiguration(): boolean {
        if (!this.ensureActiveSketchPath()) {
            return false;
        }

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
            this.migrateLegacyConfiguration();
        }
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

                if (configJson.optimize_for_debug == undefined) {
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
        const resolved = this.resolveActiveSketchPath();
        if (resolved !== ARDUINO_ERRORS.NO_ERRORS) {
            this.projectStatus.status = resolved;
            return resolved;
        }

        const activePath = this.getActiveSketchPath();
        if (!activePath) {
            this.projectStatus.status = ARDUINO_ERRORS.NO_INO_FILES;
            return ARDUINO_ERRORS.NO_INO_FILES;
        }

        let error: ARDUINO_ERRORS = ARDUINO_ERRORS.NO_INO_FILES;
        const folderName = path.basename(activePath);
        const files = fs.readdirSync(activePath);

        for (const file of files) {
            const filePath = path.join(activePath, file);

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
        // arduinoExtensionChannel.appendLine(`New monitor port settings applied: $${JSON.stringify(monitorPortSettings)}`)
        this.configJson.monitorPortSettings = monitorPortSettings;
        this.writeVSCodeArduinoConfiguration();
    }

    public updateBoardConfiguration(newConfig: string): void {
        this.configJson.configuration = newConfig;
        this.writeVSCodeArduinoConfiguration();
    }

    private writeVSCodeArduinoConfiguration() {
        if (!this.arduinoConfigurationPath) {
            return;
        }
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
        // arduinoExtensionChannel.appendLine(`Wrote configuration to ${this.arduinoConfigurationPath}`);
    }
    public getProjectPath(): string {
        return this.activeSketchPath || this.projectFullPath;
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

    public async selectSketchFolder(): Promise<boolean> {
        const candidates = this.findSketchRoots();
        if (candidates.length === 0) {
            vscode.window.showWarningMessage("No sketch folders found in the workspace.");
            return false;
        }

        const picks = candidates.map((candidate) => ({
            label: path.basename(candidate),
            description: candidate,
            path: candidate
        }));

        const selected = await vscode.window.showQuickPick(picks, {
            title: "Select a Sketch Folder",
            placeHolder: "Choose the sketch folder to use for Arduino actions",
            matchOnDescription: true
        });

        if (!selected) {
            return false;
        }

        this.setActiveSketchPath(selected.path);
        this.readConfiguration();
        return true;
    }

    public trySetActiveSketchFromFile(filePath: string): boolean {
        if (!filePath || path.extname(filePath).toLowerCase() !== ARDUINO_SKETCH_EXTENSION) {
            return false;
        }
        const folderPath = path.dirname(filePath);
        if (!this.isValidSketchFolder(folderPath)) {
            return false;
        }
        if (folderPath === this.activeSketchPath) {
            return false;
        }
        this.setActiveSketchPath(folderPath);
        return true;
    }

    private setActiveSketchPath(sketchPath: string, persist: boolean = true) {
        this.activeSketchPath = sketchPath;
        this.projectFullPath = sketchPath;
        if (persist && this.workspaceState) {
            this.workspaceState.update('activeSketchPath', sketchPath);
        }
    }

    private ensureActiveSketchPath(): boolean {
        const status = this.resolveActiveSketchPath();
        if (status === ARDUINO_ERRORS.NO_ERRORS) {
            return true;
        }
        this.projectStatus.status = status;
        return false;
    }

    private resolveActiveSketchPath(): ARDUINO_ERRORS {
        if (this.activeSketchPath) {
            if (this.isValidSketchFolder(this.activeSketchPath)) {
                return ARDUINO_ERRORS.NO_ERRORS;
            }
            this.activeSketchPath = "";
        }

        if (this.workspaceState) {
            const storedPath = this.workspaceState.get<string>('activeSketchPath');
            if (storedPath && this.isValidSketchFolder(storedPath)) {
                this.setActiveSketchPath(storedPath);
                return ARDUINO_ERRORS.NO_ERRORS;
            }
        }

        const candidates = this.findSketchRoots();
        if (candidates.length === 1) {
            this.setActiveSketchPath(candidates[0]);
            return ARDUINO_ERRORS.NO_ERRORS;
        }
        if (candidates.length > 1) {
            return ARDUINO_ERRORS.MULTIPLE_SKETCHES_FOUND;
        }
        return ARDUINO_ERRORS.NO_INO_FILES;
    }

    private findSketchRoots(): string[] {
        const roots = this.workspaceRootPaths.length > 0 ? this.workspaceRootPaths : (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
        const results: string[] = [];
        for (const root of roots) {
            this.collectSketchRoots(root, SKETCH_SEARCH_MAX_DEPTH, results);
        }
        return results;
    }

    private collectSketchRoots(currentPath: string, depth: number, results: string[]) {
        if (depth < 0) {
            return;
        }

        if (this.isValidSketchFolder(currentPath)) {
            results.push(currentPath);
            return;
        }

        let entries: any[];
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (SKETCH_IGNORE_FOLDERS.has(entry.name)) {
                continue;
            }
            this.collectSketchRoots(path.join(currentPath, entry.name), depth - 1, results);
        }
    }

    private isValidSketchFolder(folderPath: string): boolean {
        if (!folderPath) {
            return false;
        }
        const sketchName = path.basename(folderPath);
        const sketchFile = path.join(folderPath, `${sketchName}${ARDUINO_SKETCH_EXTENSION}`);
        try {
            return fs.existsSync(sketchFile);
        } catch {
            return false;
        }
    }

    private migrateLegacyConfiguration() {
        const activePath = this.getActiveSketchPath();
        if (!activePath) {
            return;
        }
        const root = this.getContainingWorkspaceRoot(activePath);
        if (!root || root === activePath) {
            return;
        }

        const legacyPath = path.join(root, VSCODE_FOLDER, ARDUINO_SETTINGS);
        if (!fs.existsSync(legacyPath)) {
            return;
        }

        try {
            fs.copyFileSync(legacyPath, this.arduinoConfigurationPath);
        } catch (error) {
            arduinoExtensionChannel.appendLine(`Failed to migrate legacy configuration from ${legacyPath}`);
        }
    }

    private getContainingWorkspaceRoot(sketchPath: string): string | undefined {
        const normalizedSketch = path.resolve(sketchPath);
        let bestMatch = "";
        const roots = this.workspaceRootPaths.length > 0 ? this.workspaceRootPaths : (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
        for (const root of roots) {
            const normalizedRoot = path.resolve(root);
            if (normalizedSketch === normalizedRoot || normalizedSketch.startsWith(normalizedRoot + path.sep)) {
                if (normalizedRoot.length > bestMatch.length) {
                    bestMatch = normalizedRoot;
                }
            }
        }
        return bestMatch || undefined;
    }

}
