import * as vscode from 'vscode';

const path = require('path');
const fs = require('fs');

const compileCommandArduino: string = 'compile';
const uploadCommandArduino: string = 'upload';
const boardCommandArduino: string = 'board';
const listFunctionArduino: string = 'list';
const jsonOutputArduino: string = '--json';
const verboseOptionArduino: string = '-v';
const buildPathArduino: string = '--build-path';
const buildCachePathArduino: string = '--build-cache-path';
const jobsOptionArduino: string = '--jobs';
const fqbnOptionArduino: string = '--fqbn';

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
        const args: string[] = [];

        args.push(compileCommandArduino);
        args.push(verboseOptionArduino);
        args.push(buildPathArduino, "\"" + this.getProjectPath() + "/" + this.getOutput() + "\"");
        args.push(buildCachePathArduino, "\"" + this.getProjectPath() + "/" +  this.getOutput() + '/cache' + "\"");
        args.push(jobsOptionArduino, '0');
        args.push(fqbnOptionArduino, this.getBoard() + ":" + this.getConfiguration());
        args.push("\"" + this.getProjectPath() + "\"");
        return args;
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
