import * as vscode from 'vscode';

const path = require('path');
const fs = require('fs');

export const cliCommandArduino: string = 'arduino-cli';
export const compileCommandArduino: string = 'compile';
const uploadCommandArduino: string = 'upload';
const boardCommandArduino: string = 'board';
const listFunctionArduino: string = 'list';
const detailsFunctionArduino: string = 'details';
const jsonOutputArduino: string = '--json';
export const verboseOptionArduino: string = '-v';
export const portOptionArduino: string = '-p';
export const buildPathArduino: string = '--build-path';
export const buildCachePathArduino: string = '--build-cache-path';
export const jobsOptionArduino: string = '--jobs';
export const fqbnOptionArduino: string = '--fqbn';
export const inputDirOptionArduino: string = '--input-dir';
export const noColorOptionArduino: string = '--no-color';
export const preprocessCompileOptionArduino: string = '--preprocess';

const CPP_PROPERTIES: string = "c_cpp_properties.json";
const VSCODE_FOLDER: string = ".vscode";
const ARDUINO_SETTINGS: string = "arduino.json";
const ARDUINO_SKETCH_EXTENSION: string = ".ino";

export class ArduinoProject {
    private arduinoConfigurationPath: string = "";
    private configJson: any;
    private projectFullPath: string = "";

    constructor() {
    }
    public readConfiguration(): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return false;
        }

        this.projectFullPath = workspaceFolders[0].uri.fsPath;
        this.arduinoConfigurationPath = path.join(this.projectFullPath, VSCODE_FOLDER, ARDUINO_SETTINGS);

        // Check if the arduino.json file exists
        if (!fs.existsSync(this.arduinoConfigurationPath)) {
            return false;
        }

        // Read the arduino.json file
        const configContent = fs.readFileSync(this.arduinoConfigurationPath, 'utf-8');
        try {
            this.configJson = JSON.parse(configContent);
        } catch (error) {
            return false;
        }

        return true;
    }
    public getCompileCommandArguments(): string[] {
        const compileCommand = [
            `${compileCommandArduino}`,
            `${verboseOptionArduino}`,
            `${noColorOptionArduino}`,
            `${fqbnOptionArduino}`,
            `${this.getBoard()}:${this.getConfiguration()}`,
            `${buildPathArduino}`,
            this.getProjectPath() + '/' + this.getOutput(),
            `${buildCachePathArduino}`,
            this.getProjectPath() + '/' + this.getOutput() + '/cache',
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
            `${this.getBoard()}:${this.getConfiguration()}`,
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
            `${this.getBoard()}:${this.getConfiguration()}`,
            `${inputDirOptionArduino}`,
            this.getProjectPath() + '/' + this.getOutput(),
            this.getProjectPath()
        ];
        return compileCommand;
    }
    public getPortListArguments(): string[] {
        const compileCommand = [
            `${boardCommandArduino}`,
            `${listFunctionArduino}`,
            `${jsonOutputArduino}`
        ];
        return compileCommand;
    }
    public getBoardConfigurationArguments(): string[] {
        const compileCommand = [
            `${boardCommandArduino}`,
            `${detailsFunctionArduino}`,
            `${fqbnOptionArduino}`,
            `${this.getBoard()}:${this.getConfiguration()}`,
            `${jsonOutputArduino}`
        ];
        return compileCommand;
    }
    public isFolderArduinoProject(): boolean {
        try {
            // Read the contents of the folder
            const files = fs.readdirSync(this.getProjectPath());

            // Check if any files have the .ino extension
            const hasInoFile = files.some((file) => {
                // Get the full path of the file
                const filePath = path.join(this.getProjectPath(), file);

                // Check if it's a file and has a .ino extension
                return fs.statSync(filePath).isFile() && path.extname(file).toLowerCase() === ARDUINO_SKETCH_EXTENSION;
            });

            return hasInoFile;
        } catch (error) {
            console.error('Error reading folder:', error);
            return false;
        }
    }
    public generateCppPropertiesFromCompileOutput(output: string) {
        const includePaths = new Set<string>();  // Use Set to avoid duplicates
        const defines = new Set<string>();  // Use Set to avoid duplicates
    
        // Regular expressions to match include paths and defines
        const includeRegex = /-I([^\s]+)/g;
        const defineRegex = /-D([^\s]+)/g;
    
        let match;
        while ((match = includeRegex.exec(output)) !== null) {
            includePaths.add(match[1]);  // Add to Set
        }
    
        while ((match = defineRegex.exec(output)) !== null) {
            defines.add(match[1]);  // Add to Set
        }
    
        // Convert Sets back to arrays
        const includePathsArray = Array.from(includePaths);
        const definesArray = Array.from(defines);
    
        // Create c_cpp_properties.json
        const cppProperties = {
            configurations: [{
                name: "Arduino",
                includePath: includePathsArray,  // Use the array
                defines: definesArray,  // Use the array
                compilerPath: "/path/to/compiler",  // You can retrieve this from output if needed
                cStandard: "c11",
                cppStandard: "c++17",
                intelliSenseMode: "gcc-x86"
            }],
            version: 4
        };
    
        // Write the c_cpp_properties.json file
        const cppPropertiesPath = path.join(this.getProjectPath(), VSCODE_FOLDER, CPP_PROPERTIES);
        fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));
    
        vscode.window.showInformationMessage('Generated c_cpp_properties.json for IntelliSense.');
    }
    

    public setPort(port: string): void {
        // Update the configJson object
        this.configJson.port = port;

        // Write the updated configuration back to the arduino.json file
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public updateBoardConfiguration(newConfig: string): void {

        // Step 2: Replace the configuration in configJson with the new configuration string
        this.configJson.configuration = newConfig;

        // Step 3: Write the updated configuration back to the arduino.json file
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }

    public getOutput(): string {
        return this.configJson.output || 'build';
    }
    public getConfiguration(): string {
        return this.configJson.configuration || '';
    }
    public getPort(): string {
        return this.configJson.port || '';
    }
    public getBoard(): string {
        return this.configJson.board || '';
    }
    public getProjectPath(): string {
        return this.projectFullPath;
    }
}
