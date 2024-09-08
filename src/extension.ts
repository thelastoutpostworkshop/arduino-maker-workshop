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
	context.subscriptions.push(vsCommandBoardConfiguration());
}

function loadArduinoConfiguration() {
	arduinoProject = new ArduinoProject();

	if (!arduinoProject.readConfiguration()) {
		vscode.window.showInformationMessage('Arduino Configuration Error');
	}

}

function vsCommandBoardConfiguration(): vscode.Disposable {
    return vscode.commands.registerCommand('vscode-arduino.boardconfig', async () => {
        if (!verifyArduinoProject()) {
            return;
        }

        if (!arduinoProject.getProjectPath()) {
            vscode.window.showInformationMessage('Project path not found, cannot retrieve board configuration.');
            return;
        }

        if (!arduinoProject.getBoard()) {
            vscode.window.showInformationMessage('Board info not found, cannot retrieve board configuration.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Retrieving board configuration options...',
            cancellable: false
        }, async (progress) => {
            const configBoardArgs = arduinoProject.getBoardConfigurationArguments();

            try {
                const result = await executeArduinoCommand(`${cliCommandArduino}`, configBoardArgs, true);
                if (result) {
                    progress.report({ message: 'Board Configuration retrieved.', increment: 100 });

                    // Parse the JSON result
                    const configuration = JSON.parse(result).config_options;
                    
                    if (configuration.length === 0) {
                        vscode.window.showInformationMessage('Unable to retrieve board configuration.');
                        return;
                    }

                    // Create a new webview panel
                    const panel = vscode.window.createWebviewPanel(
                        'boardConfig', 
                        'Arduino Board Configuration', 
                        vscode.ViewColumn.One, 
                        { enableScripts: true }
                    );

                    // Set the HTML content with the configuration options
                    panel.webview.html = getWebviewContent(configuration);

                    // Handle messages from the webview
                    panel.webview.onDidReceiveMessage(
                        message => {
                            switch (message.command) {
                                case 'updateConfig':
                                    // Update configuration in the project
                                    arduinoProject.updateBoardConfiguration(message.config);
                                    vscode.window.showInformationMessage('Configuration updated!');
                                    return;
                            }
                        },
                        undefined,
                        context.subscriptions
                    );
                } else {
                    vscode.window.showErrorMessage('Failed to retrieve board configuration.');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Error retrieving board configuration: ${error}`);
            }
        });
    });
}

function getWebviewContent(configuration: any[]): string {
    let html = `
    <html>
    <body>
        <h1>Board Configuration</h1>
        <form id="configForm">`;

    // Iterate over configuration options and create a select input for each
    configuration.forEach(option => {
        html += `<label for="${option.option}">${option.option_label}</label>
        <select id="${option.option}" name="${option.option}">`;

        option.values.forEach(value => {
            html += `<option value="${value.value}" ${value.selected ? 'selected' : ''}>${value.value_label}</option>`;
        });

        html += `</select><br/><br/>`;
    });

    html += `
        <button type="submit">Update Configuration</button>
        </form>
        <script>
            const vscode = acquireVsCodeApi();

            document.getElementById('configForm').addEventListener('submit', function(e) {
                e.preventDefault();

                const formData = new FormData(e.target);
                let config = {};

                formData.forEach((value, key) => {
                    config[key] = value;
                });

                vscode.postMessage({
                    command: 'updateConfig',
                    config: config
                });
            });
        </script>
    </body>
    </html>`;

    return html;
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
	
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Retrieving available ports...',
			cancellable: false
		}, async (progress) => {
			// Execute the Arduino CLI command to get the list of ports
			const portListCommand = arduinoProject.getPortListArguments();
	
			// Use executeArduinoCommand and pass true to get the output as a string
			try {
				const result = await executeArduinoCommand(`${cliCommandArduino}`, portListCommand, true);
				if (result) {
					progress.report({ message: 'Ports have been successfully retrieved.',increment:100 });

					// Parse the JSON result
					const ports = JSON.parse(result).detected_ports;
	
					if (ports.length === 0) {
						vscode.window.showInformationMessage('No ports detected.');
						return;
					}
	
					// Create QuickPick items from the list of detected ports
					const portItems = ports.map((port: any) => ({
						label: port.port.label,
						description: port.port.protocol_label
					}));
	
					// Show the QuickPick to the user
					const selectedPort = await vscode.window.showQuickPick(portItems, {
						placeHolder: 'Select a port to use for uploading'
					});
	
					if (selectedPort) {
						vscode.window.showInformationMessage(`Selected port: ${selectedPort.label}`);
						// Set the selected port in your project settings or wherever needed
						arduinoProject.setPort(selectedPort.label);
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

