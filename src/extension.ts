import * as vscode from 'vscode';
import { ArduinoProject, cliCommandArduino } from './ArduinoProject';
const cp = require('child_process');


const outputChannel = vscode.window.createOutputChannel('Arduino');
let arduinoProject: ArduinoProject;

export function activate(context: vscode.ExtensionContext) {
	loadArduinoConfiguration();
	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandUpload());
}

function loadArduinoConfiguration() {
	arduinoProject = new ArduinoProject();

	if (!arduinoProject.readConfiguration()) {
		vscode.window.showInformationMessage('Arduino Configuration Error');
	}

}
function vsCommandUpload():vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.upload', () => {

		if (!arduinoProject.getBoard()) {
			vscode.window.showInformationMessage('Board info not found, cannot compile');
		}
		if (!arduinoProject.getConfiguration()) {
			vscode.window.showInformationMessage('Board configuration not found, cannot compile');
		}
		if (!arduinoProject.getProjectPath()) {
			vscode.window.showInformationMessage('Project path not found, cannot compile');
		}
		if (!arduinoProject.getPort()) {
			vscode.window.showInformationMessage('Port not found, cannot compile');
		}

		// Execute the Arduino CLI command
		const uploadCommand = arduinoProject.getCompileUploadArguments();
		executeArduinoCommand(`${cliCommandArduino}`,uploadCommand);

	});
}

function vsCommandCompile():vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.compile', () => {

		if (!arduinoProject.getBoard()) {
			vscode.window.showInformationMessage('Board info not found, cannot compile');
		}
		if (!arduinoProject.getConfiguration()) {
			vscode.window.showInformationMessage('Board configuration not found, cannot compile');
		}
		if (!arduinoProject.getOutput()) {
			vscode.window.showInformationMessage('Output not found, cannot compile');
		}
		if (!arduinoProject.getProjectPath()) {
			vscode.window.showInformationMessage('Project path not found, cannot compile');
		}

		// Execute the Arduino CLI command
		const compileCommand = arduinoProject.getCompileCommandArguments();
		executeArduinoCommand(`${cliCommandArduino}`,compileCommand);

	});
}

function executeArduinoCommand(command: string, args: string[]) {

	outputChannel.clear();
	outputChannel.show(true);
	outputChannel.appendLine('Running Arduino CLI...');
	outputChannel.appendLine(`${cliCommandArduino}`);
	outputChannel.appendLine(args.join(' '));

	const child = cp.spawn(`${command}`, args);

	// Stream stdout to the output channel
	child.stdout.on('data', (data: Buffer) => {
		outputChannel.appendLine(data.toString());
	});

	// Stream stderr to the output channel
	child.stderr.on('data', (data: Buffer) => {
		outputChannel.appendLine(`Error: ${data.toString()}`);
	});

	// Handle the process exit event
	child.on('close', (code: number) => {
		if (code === 0) {
			// vscode.window.showInformationMessage('Compilation successful.');
		} else {
			vscode.window.showErrorMessage(`Compilation failed with code ${code}. Check Output window for details.`);
		}
	});

}

export function deactivate() { }

