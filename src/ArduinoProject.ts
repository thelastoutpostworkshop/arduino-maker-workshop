import * as vscode from 'vscode';

const path = require('path');
const fs = require('fs');

export const cliCommandArduino: string = 'arduino-cli';
export const compileCommandArduino: string = 'compile';
const uploadCommandArduino: string = 'upload';
const boardCommandArduino: string = 'board';
const listFunctionArduino: string = 'list';
const detailsFunctionArduino:string = 'details';
const jsonOutputArduino: string = '--json';
export const verboseOptionArduino: string = '-v';
export const portOptionArduino: string = '-p';
export const buildPathArduino: string = '--build-path';
export const buildCachePathArduino: string = '--build-cache-path';
export const jobsOptionArduino: string = '--jobs';
export const fqbnOptionArduino: string = '--fqbn';
export const inputDirOptionArduino: string = '--input-dir';
export const noColorOptionArduino: string = '--no-color';

export class ArduinoProject {
    private arduinoConfigurationPath: string = "";
    private configJson: any;
    private configuration: string = "";
    private board: string = "";
    private output: string = "";
    private port: string = "";
    private projectFullPath: string = "";

    constructor() {
    }
    public readConfiguration(): boolean {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return false;
        }

        this.projectFullPath = workspaceFolders[0].uri.fsPath;
        this.arduinoConfigurationPath = path.join(this.projectFullPath, '.vscode', 'arduino.json');

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


        // Extract relevant fields from arduino.json
        this.configuration = this.configJson.configuration || '';
        this.board = this.configJson.board || '';
        this.output = this.configJson.output || 'build';
        this.port = this.configJson.port || '';

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
    public getCompileUploadArguments(): string[] {
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
                return fs.statSync(filePath).isFile() && path.extname(file).toLowerCase() === '.ino';
            });

            return hasInoFile;
        } catch (error) {
            console.error('Error reading folder:', error);
            return false;
        }
    }
    public setPort(port: string): void {
        this.port = port;
    
        // Update the configJson object
        this.configJson.port = port;
    
        // Write the updated configuration back to the arduino.json file
        fs.writeFileSync(this.arduinoConfigurationPath, JSON.stringify(this.configJson, null, 2), 'utf-8');
    }
    public getOutput(): string {
        return this.output;
    }
    public getConfiguration(): string {
        return this.configuration;
    }
    public getPort(): string {
        return this.port;
    }
    public getBoard(): string {
        return this.board;
    }
    public getProjectPath(): string {
        return this.projectFullPath;
    }
}
