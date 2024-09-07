import * as vscode from 'vscode';
import { ArduinoProject } from './ArduinoProject';
const cp = require('child_process');

const cliCommandArduino: string = 'arduino-cli';


let arduinoProject: ArduinoProject;

export function activate(context: vscode.ExtensionContext) {
	// Create an output channel
	const outputChannel = vscode.window.createOutputChannel('Arduino');

	arduinoProject = new ArduinoProject();

	if (!arduinoProject.readConfiguration()) {
		vscode.window.showInformationMessage('Arduino Configuration Error');
	}

	// Register the compile command
	let disposable = vscode.commands.registerCommand('vscode-arduino.compile', () => {

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

		outputChannel.clear();
		outputChannel.appendLine('Running Arduino CLI compile...');
		outputChannel.show(true);

		// Execute the Arduino CLI command
		const compileCommand = arduinoProject.getCompileCommandArguments();
		outputChannel.appendLine(`${cliCommandArduino}`);
		outputChannel.appendLine(compileCommand.join(' ')); // Join for displaying the full command in the output

		const child = cp.spawn(`${cliCommandArduino}`, compileCommand);

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
	});

	// Push the disposable command to the context's subscriptions
	context.subscriptions.push(disposable);
}

export function deactivate() { }

