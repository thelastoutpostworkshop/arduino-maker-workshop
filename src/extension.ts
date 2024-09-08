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
function vsCommandPort(): vscode.Disposable {
    return vscode.commands.registerCommand('vscode-arduino.port', async () => {
        if (!verifyArduinoProject()) {
            return;
        }

        if (!arduinoProject.getProjectPath()) {
            vscode.window.showInformationMessage('Project path not found, cannot retrieve ports.');
            return;
        }

        // Execute the Arduino CLI command to get the list of ports
        const portListCommand = arduinoProject.getPortListArguments();

        // Use executeArduinoCommand and pass true to get the output as a string
        try {
            const result = await executeArduinoCommand(`${cliCommandArduino}`, portListCommand, true);
            
            if (result) {
                // Parse the JSON result
                const ports = JSON.parse(result).detected_ports;

                if (ports.length === 0) {
                    vscode.window.showInformationMessage('No ports detected.');
                    return;
                }

                // Create QuickPick items from the list of detected ports
                const portItems = ports.map((port: any) => ({
                    label: port.port.label,
                    description: port.port.address
                }));

                // Show the QuickPick to the user
                const selectedPort = await vscode.window.showQuickPick(portItems, {
                    placeHolder: 'Select a port to use for uploading'
                });

                if (selectedPort) {
                    vscode.window.showInformationMessage(`Selected port: ${selectedPort.label}`);
                    // Set the selected port in your project settings or wherever needed
                    // arduinoProject.setPort(selectedPort.label);
                } else {
                    vscode.window.showInformationMessage('No port selected.');
                }
            } else {
                vscode.window.showErrorMessage('Failed to retrieve port list.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error retrieving port list: ${error}`);
        }
    });
}


function vsCommandUpload():vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.upload', () => {
		if(!verifyArduinoProject()) {
			return;
		}

		if (!arduinoProject.getBoard()) {
			vscode.window.showInformationMessage('Board info not found, cannot upload');
		}
		if (!arduinoProject.getConfiguration()) {
			vscode.window.showInformationMessage('Board configuration not found, cannot upload');
		}
		if (!arduinoProject.getProjectPath()) {
			vscode.window.showInformationMessage('Project path not found, cannot upload');
		}
		if (!arduinoProject.getPort()) {
			vscode.window.showInformationMessage('Port not found, cannot upload');
		}

		// Execute the Arduino CLI command
		const uploadCommand = arduinoProject.getCompileUploadArguments();
		const output = executeArduinoCommand(`${cliCommandArduino}`,uploadCommand,true);

	});
}

function vsCommandCompile():vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.compile', () => {
		if(!verifyArduinoProject()) {
			return;
		}
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

function verifyArduinoProject():boolean {
	if(!arduinoProject.isFolderArduinoProject()) {
		vscode.window.showErrorMessage(`Not an Arduino Project.`);	
		return false;
	}
	return true;
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

