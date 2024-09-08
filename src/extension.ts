import * as vscode from 'vscode';
import { ArduinoProject, cliCommandArduino } from './ArduinoProject';
const cp = require('child_process');


const outputChannel = vscode.window.createOutputChannel('Arduino');
let arduinoProject: ArduinoProject;

export function activate(context: vscode.ExtensionContext) {
	loadArduinoConfiguration();
	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandUpload());
	context.subscriptions.push(vsCommandPort());
}

function loadArduinoConfiguration() {
	arduinoProject = new ArduinoProject();

	if (!arduinoProject.readConfiguration()) {
		vscode.window.showInformationMessage('Arduino Configuration Error');
	}

}
function vsCommandPort():vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.port', () => {

		// if (!arduinoProject.getBoard()) {
		// 	vscode.window.showInformationMessage('Board info not found, cannot compile');
		// }
		// if (!arduinoProject.getConfiguration()) {
		// 	vscode.window.showInformationMessage('Board configuration not found, cannot compile');
		// }
		// if (!arduinoProject.getProjectPath()) {
		// 	vscode.window.showInformationMessage('Project path not found, cannot compile');
		// }
		// if (!arduinoProject.getPort()) {
		// 	vscode.window.showInformationMessage('Port not found, cannot compile');
		// }

		// // Execute the Arduino CLI command
		// const uploadCommand = arduinoProject.getCompileUploadArguments();
		// executeArduinoCommand(`${cliCommandArduino}`,uploadCommand);

	});
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

function executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false): Promise<string | void> {
    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine('Running Arduino CLI...');
    outputChannel.appendLine(`${command}`);
    outputChannel.appendLine(args.join(' '));

    const child = cp.spawn(`${command}`, args);
    let outputBuffer = '';  // String buffer to store output

    return new Promise((resolve, reject) => {
        // Stream stdout to the output channel and optionally to the buffer
        child.stdout.on('data', (data: Buffer) => {
            const output = data.toString();
            outputChannel.appendLine(output);

            if (returnOutput) {
                outputBuffer += output;
            }
        });

        // Stream stderr to the output channel and optionally to the buffer
        child.stderr.on('data', (data: Buffer) => {
            const error = `Error: ${data.toString()}`;
            outputChannel.appendLine(error);

            if (returnOutput) {
                outputBuffer += error;
            }
        });

        // Handle the process exit event
        child.on('close', (code: number) => {
            if (code === 0) {
                // Successful completion
                vscode.window.showInformationMessage('Command executed successfully.');
                resolve(returnOutput ? outputBuffer : undefined);
            } else {
                // Command failed
                vscode.window.showErrorMessage(`Command failed with code ${code}. Check Output window for details.`);
                reject(`Command failed with code ${code}`);
            }
        });

        // Handle error event in case the command fails to start
        child.on('error', (err) => {
            vscode.window.showErrorMessage(`Failed to run command: ${err.message}`);
            reject(`Failed to run command: ${err.message}`);
        });
    });
}

export function deactivate() { }

