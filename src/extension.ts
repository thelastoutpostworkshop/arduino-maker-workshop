import * as vscode from 'vscode';
import { ARDUINO_ERRORS, ArduinoProject, cliCommandArduino } from './ArduinoProject';
import { ComPortProvider, ComPortItem } from './ComPortProvider';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const outputChannel = vscode.window.createOutputChannel('Arduino');
export let arduinoProject: ArduinoProject;
let boardConfigWebViewPanel: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandUpload());
	context.subscriptions.push(vsCommandPort());
	context.subscriptions.push(vsCommandBoardConfiguration(context));
	context.subscriptions.push(vsCommandBoardSelection(context));

	const comPortProvider = new ComPortProvider();
	vscode.window.registerTreeDataProvider('comPortView', comPortProvider);

	// Register refresh command
	context.subscriptions.push(
		vscode.commands.registerCommand('comPortExplorer.refresh', () => comPortProvider.refresh())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('comPortExplorer.command1', (item: ComPortItem) => {
			vscode.window.showInformationMessage(`Command 1 executed on ${item.label}`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('comPortExplorer.command2', (item: ComPortItem) => {
			vscode.window.showInformationMessage(`Command 2 executed on ${item.label}`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('comPortExplorer.selectPort', (item: ComPortItem) => {
			if (loadArduinoConfiguration()) {
				arduinoProject.setPort(item.label);
				comPortProvider.setSelectedPort(item.label);
			}
		})
	);
}

export function loadArduinoConfiguration(): boolean {
	arduinoProject = new ArduinoProject();

	const res = arduinoProject.isFolderArduinoProject();
	if (res !== ARDUINO_ERRORS.NO_ERRORS) {
		let message: string = "";
		switch (res) {
			case ARDUINO_ERRORS.NO_INO_FILES:
				message = "No sketch file (.ino) found";
				break;
			case ARDUINO_ERRORS.WRONG_FOLDER_NAME:
				message = "Folder and sketch name mismatch";
				break;
			default:
				break;
		}
		vscode.window.showErrorMessage(message);
		return false;
	} else {
		if (!arduinoProject.readConfiguration()) {
			vscode.window.showErrorMessage('Arduino Configuration Error');
			return false;
		}
	}
	return true;
}

function vsCommandBoardSelection(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.boardselect', async () => {
		if (!loadArduinoConfiguration()) {
			return false;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Retrieving board list...',
			cancellable: false
		}, async (progress) => {
			const listBoardArgs = arduinoProject.getBoardsListArguments();
			try {
				const result = await executeArduinoCommand(`${cliCommandArduino}`, listBoardArgs, true);
				if (result) {
					progress.report({ message: 'Board list retrieved.', increment: 100 });
					const boardList = JSON.parse(result).boards;

					// Initialize an empty object to hold the structured board data
					const boardStructure: { [platform: string]: { name: string, fqbn: string }[] } = {};

					// Create a Set to track unique fqbn values
					const uniqueFqbnSet = new Set<string>();

					boardList.forEach((board: any) => {
						const platformName = board.platform.release.name; // Get the platform release name (e.g., "Arduino AVR Boards")

						// Initialize the platform in the structure if it doesn't exist
						if (!boardStructure[platformName]) {
							boardStructure[platformName] = [];
						}

						// Loop through each board under this platform
						board.platform.release.boards.forEach((boardInfo: any) => {
							const { name, fqbn } = boardInfo;

							// Only add if the fqbn is not a duplicate
							if (!uniqueFqbnSet.has(fqbn)) {
								uniqueFqbnSet.add(fqbn);
								boardStructure[platformName].push({ name, fqbn });
							}
						});
					});

					// Show the board selection webview
					showBoardSelectionWebview(context, boardStructure);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Error retrieving board list: ${error}`);
			}
		});
	});
}

function showBoardSelectionWebview(context: vscode.ExtensionContext, boardStructure: { [platform: string]: { name: string, fqbn: string }[] }) {
	const panel = vscode.window.createWebviewPanel(
		'boardSelect', // Identifies the type of the webview
		'Select Arduino Board', // Title of the webview panel
		vscode.ViewColumn.One, // Editor column to show the new webview panel in
		{
			enableScripts: true // Enable JavaScript in the webview
		}
	);

	// Construct the HTML content for the webview with dropdown
	panel.webview.html = getBoardSelectionHtml(boardStructure);

	// Handle messages from the webview
	panel.webview.onDidReceiveMessage(message => {
		switch (message.command) {
			case 'selectBoard':
				vscode.window.showInformationMessage(`Board Selected: ${message.fqbn}`);
				panel.dispose(); // Close the webview
				return;
		}
	});
}

function getBoardSelectionHtml(boardStructure: { [platform: string]: { name: string, fqbn: string }[] }) {
	let htmlContent = `
        <html>
        <head>
            <style>
                body {
                    font-family: sans-serif;
                    padding: 10px;
                }
                select {
                    width: 100%;
                    padding: 8px;
                    margin-bottom: 20px;
                    border-radius: 4px;
                    border: 1px solid #ddd;
                }
                button {
                    padding: 10px 15px;
                    font-size: 16px;
                    border: none;
                    border-radius: 4px;
                    background-color: #007acc;
                    color: white;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #005fa3;
                }
            </style>
        </head>
        <body>
            <h1>Select Arduino Board</h1>
            <form id="boardForm">
    `;

	// Loop through the platforms and add a dropdown for each one
	for (const platform in boardStructure) {
		htmlContent += `
            <h2>${platform}</h2>
            <select id="select-${platform.replace(/\s+/g, '-')}" onchange="onBoardSelect('${platform}')">
                <option value="">Select a board...</option>
        `;
		boardStructure[platform].forEach(board => {
			htmlContent += `<option value="${board.fqbn}">${board.name} (${board.fqbn})</option>`;
		});
		htmlContent += `</select>`;
	}

	htmlContent += `
            <button type="button" onclick="submitBoardSelection()">Submit</button>
            </form>

            <script>
                let selectedFqbn = '';

                function onBoardSelect(platform) {
                    const selectElement = document.getElementById('select-' + platform.replace(/\\s+/g, '-'));
                    selectedFqbn = selectElement.value;
                }

                function submitBoardSelection() {
                    if (selectedFqbn) {
                        vscode.postMessage({ command: 'selectBoard', fqbn: selectedFqbn });
                    } else {
                        alert('Please select a board.');
                    }
                }

                const vscode = acquireVsCodeApi();
            </script>
        </body>
        </html>
    `;

	return htmlContent;
}


function vsCommandBoardConfiguration(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.boardconfig', async () => {
		if (!loadArduinoConfiguration()) {
			return false;
		}

		if (!arduinoProject.getBoard()) {
			vscode.window.showErrorMessage('Select a board first');
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
					const configData = JSON.parse(result);
					const configuration = configData.config_options;
					const boardName = configData.name; // Extract the board name

					if (configuration.length === 0) {
						vscode.window.showInformationMessage('Unable to retrieve board configuration.');
						return;
					}

					const columnToShowIn = vscode.window.activeTextEditor
						? vscode.window.activeTextEditor.viewColumn
						: undefined;

					if (boardConfigWebViewPanel) {
						boardConfigWebViewPanel.reveal(columnToShowIn);
					} else {
						boardConfigWebViewPanel = vscode.window.createWebviewPanel(
							'boardConfig',
							'Arduino Board Configuration',
							columnToShowIn || vscode.ViewColumn.One,
							{
								enableScripts: true, retainContextWhenHidden: true
							}
						);

					}

					// Set the HTML content with the configuration options
					boardConfigWebViewPanel.webview.html = getWebviewContent(boardName, configuration);

					// Handle messages from the webview
					boardConfigWebViewPanel.webview.onDidReceiveMessage(
						message => {
							switch (message.command) {
								case 'updateConfig':
									// Merge the incoming config change with the existing configuration
									const currentConfig = arduinoProject.getConfiguration()
										.split(',')
										.reduce((configObj: any, item: string) => {
											const [key, value] = item.split('=');
											configObj[key] = value;
											return configObj;
										}, {});

									// Update only the changed field
									const updatedConfig = { ...currentConfig, ...message.config };

									// Convert updated config object back to string format "key=value,key=value"
									const updatedConfigString = Object.entries(updatedConfig)
										.map(([key, value]) => `${key}=${value}`)
										.join(',');

									// Update the configuration in the project
									arduinoProject.updateBoardConfiguration(updatedConfigString);

									// vscode.window.showInformationMessage('Configuration updated!');
									return;
							}
						},
						undefined,
						context.subscriptions
					);

					// Reset when the current panel is closed
					boardConfigWebViewPanel.onDidDispose(
						() => {
							boardConfigWebViewPanel = undefined;
						},
						null,
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

function getWebviewContent(boardName: string, configuration: any[]): string {
	let html = `
    <html>
    <head>
        <style>
            body {
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                padding: 10px;
            }

            h1 {
                color: var(--vscode-editor-foreground);
            }

            label {
                color: var(--vscode-foreground);
                display: block;
                margin-bottom: 5px;
            }

            select {
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                padding: 5px;
                margin-bottom: 10px;
                width: 100%;
            }

            button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 10px;
                cursor: pointer;
            }

            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <h1>${boardName} - Board Configuration</h1> <!-- Show board name -->
        <form id="configForm">`;

	// Parse the current configuration string into an object
	const currentConfig = arduinoProject.getConfiguration()
		.split(',')
		.reduce((configObj: any, item: string) => {
			const [key, value] = item.split('=');
			configObj[key] = value;
			return configObj;
		}, {});

	// Iterate over configuration options and create a select input for each
	configuration.forEach(option => {
		html += `<label for="${option.option}">${option.option_label}</label>
        <select id="${option.option}" name="${option.option}" class="config-select">`;

		option.values.forEach(value => {
			// Check if the value matches the current config value for this option
			const isSelected = currentConfig[option.option] === value.value ? 'selected' : '';
			html += `<option value="${value.value}" ${isSelected}>${value.value_label}</option>`;
		});

		html += `</select><br/>`;
	});

	html += `
        </form>

        <script>
            const vscode = acquireVsCodeApi();

            // Add change event listeners to all select elements to update configuration in real time
            document.querySelectorAll('.config-select').forEach(select => {
                select.addEventListener('change', function(e) {
                    const config = {};
                    config[this.name] = this.value;

                    // Send the updated config back to the extension
                    vscode.postMessage({
                        command: 'updateConfig',
                        config: config
                    });
                });
            });

            // Handle form submission
            document.getElementById('configForm').addEventListener('submit', function(e) {
                e.preventDefault();

                const formData = new FormData(e.target);
                let config = {};

                formData.forEach((value, key) => {
                    config[key] = value;
                });

                // Send the updated config back to the extension
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
		if (!loadArduinoConfiguration()) {
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
					progress.report({ message: 'Ports have been successfully retrieved.', increment: 100 });

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


function vsCommandUpload(): vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.upload', () => {
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			vscode.window.showInformationMessage('Board info not found, cannot upload');
		}
		if (!arduinoProject.getConfiguration()) {
			vscode.window.showInformationMessage('Board configuration not found, cannot upload');
		}
		if (!arduinoProject.getPort()) {
			vscode.window.showInformationMessage('Port not found, cannot upload');
		}

		// Execute the Arduino CLI command
		const uploadCommand = arduinoProject.getUploadArguments();
		const output = executeArduinoCommand(`${cliCommandArduino}`, uploadCommand, true);

	});
}

function vsCommandCompile(): vscode.Disposable {
	return vscode.commands.registerCommand('vscode-arduino.compile', () => {
		if (!loadArduinoConfiguration()) {
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

		// Execute the Arduino CLI command
		const compileCommand = arduinoProject.getCompileCommandArguments();
		executeArduinoCommand(`${cliCommandArduino}`, compileCommand, true)
			.then(output => {
				if (output) {
					// Parse the output and generate c_cpp_properties.json
					arduinoProject.generateCppPropertiesFromCompileOutput(output);
				}
			})
			.catch(error => {
				vscode.window.showErrorMessage(`Failed to generate c_cpp_properties.json: ${error}`);
			});

	});
}

export function executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true): Promise<string | void> {
	outputChannel.clear();
	if (showOutput) {
		outputChannel.show(true);
	}
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
				// vscode.window.showInformationMessage('Command executed successfully.');
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

