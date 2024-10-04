import { window, WebviewPanel, ExtensionContext, commands, ProgressLocation, Disposable, ViewColumn, workspace } from "vscode";
import { ARDUINO_ERRORS, ArduinoProject, cliCommandArduino } from './ArduinoProject';
import { ComPortProvider } from './ComPortProvider';
import { BoardProvider, BoardItem } from './BoardProvider';
import { VueWebviewPanel } from './VueWebviewPanel';
import { QuickAccessProvider } from './quickAccessProvider';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const outputChannel = window.createOutputChannel('Arduino');
export const arduinoExtensionChannel = window.createOutputChannel('Arduino.Extension');
arduinoExtensionChannel.appendLine("Arduino Extension started");

export let arduinoProject: ArduinoProject;
let cliCommandArduinoPath: string="";
let boardConfigWebViewPanel: WebviewPanel | undefined = undefined;

export function activate(context: ExtensionContext) {

	// Read the arduino-cli path setting
	const config = workspace.getConfiguration();
	cliCommandArduinoPath = config.get<string>('cli.path',"");
	arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${cliCommandArduinoPath}`);
	
	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('cli.path')) {
				cliCommandArduinoPath = workspace.getConfiguration().get<string>('cli.path', '');
				arduinoExtensionChannel.appendLine(`Arduino CLI Path Changed: ${cliCommandArduinoPath}`);
			}
		})
	);

	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandUpload());
	context.subscriptions.push(vsCommandPort());
	context.subscriptions.push(vsCommandBoardConfiguration(context));
	context.subscriptions.push(vsCommandBoardSelection(context));

	const quickAccessProvider = new QuickAccessProvider();
	window.registerTreeDataProvider('quickAccessView', quickAccessProvider);

	const comPortProvider = new ComPortProvider();
	window.registerTreeDataProvider('comPortView', comPortProvider);

	context.subscriptions.push(
		commands.registerCommand('comPortSelector.refresh', () => comPortProvider.refresh())
	);

	context.subscriptions.push(
		commands.registerCommand('comPortSelector.command1', () => {
			window.showInformationMessage(`Command 1 executed on `);
		})
	);

	context.subscriptions.push(
		commands.registerCommand('comPortSelector.command2', () => {
			window.showInformationMessage(`Command 2 executed on }`);
		})
	);

	context.subscriptions.push(
		commands.registerCommand('comPortSelector.selectPort', (item) => {
			if (loadArduinoConfiguration()) {
				arduinoProject.setPort(item.label);
				comPortProvider.refresh();
			}
		})
	);

	context.subscriptions.push(
		commands.registerCommand('extension.openVueWebview', () => {
			VueWebviewPanel.render(context.extensionUri);
		})
	);

	const boardProvider = new BoardProvider();
	window.registerTreeDataProvider('boardSelectorView', boardProvider);

	// Register the selectBoard command
	context.subscriptions.push(
		commands.registerCommand('boardSelector.selectBoard', (item: BoardItem) => {
			if (loadArduinoConfiguration()) {
				//    arduinoProject.setBoard(item.fqbn || '');
				window.showInformationMessage(`Selected Board: ${item.label}`);
			}
		})
	);

	context.subscriptions.push(
		commands.registerCommand('boardSelector.refresh', () => {
			boardProvider.refresh();
		})
	);

	// Register the filterBoards command
	context.subscriptions.push(
		commands.registerCommand('boardSelector.filterBoards', () => {
			boardProvider.showFilterInput();
		})
	);
	context.subscriptions.push(
		commands.registerCommand('boardSelector.clearFilter', () => {
			boardProvider.clearFilter();
		})
	);
}

export function checkArduinoCLICommand(): Promise<boolean> {
    return new Promise((resolve) => {
        if (cliCommandArduinoPath === '') {
            window.showErrorMessage('Arduino CLI Path not set in your settings');
            resolve(false);
            return;
        }

        const arduinoVersionArgs = arduinoProject.getVersionArguments();

        executeArduinoCommand(`${cliCommandArduinoPath}`, arduinoVersionArgs, true)
            .then((result) => {
                if (result) {
                    try {
                        const cliInfo = JSON.parse(result as string);
                        const version = cliInfo.VersionString;
                        const commit = cliInfo.Commit;
                        const date = new Date(cliInfo.Date).toLocaleDateString();

                        const versionMessage = `Arduino CLI version: ${version}, Commit: ${commit}, Date: ${date}`;
                        window.showInformationMessage(versionMessage);
                        arduinoExtensionChannel.appendLine(versionMessage);

                        resolve(true);
                    } catch (parseError) {
                        window.showErrorMessage('Failed to parse Arduino CLI version information.');
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            })
            .catch((error) => {
                window.showErrorMessage(`Failed to execute Arduino CLI command: ${error}`);
                resolve(false);
            });
    });
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
		window.showErrorMessage(message);
		return false;
	} else {
		if (!arduinoProject.readConfiguration()) {
			window.showErrorMessage('Arduino Configuration Error');
			return false;
		}
	}
	return true;
}

function vsCommandBoardSelection(context: ExtensionContext): Disposable {
	return commands.registerCommand('vscode-arduino.boardselect', async () => {
		if (!loadArduinoConfiguration()) {
			return false;
		}

		await window.withProgress({
			location: ProgressLocation.Notification,
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
				window.showErrorMessage(`Error retrieving board list: ${error}`);
			}
		});
	});
}

function showBoardSelectionWebview(context: ExtensionContext, boardStructure: { [platform: string]: { name: string, fqbn: string }[] }) {
	const panel = window.createWebviewPanel(
		'boardSelect', // Identifies the type of the webview
		'Select Arduino Board', // Title of the webview panel
		ViewColumn.One, // Editor column to show the new webview panel in
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
				window.showInformationMessage(`Board Selected: ${message.fqbn}`);
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


function vsCommandBoardConfiguration(context: ExtensionContext): Disposable {
	return commands.registerCommand('vscode-arduino.boardconfig', async () => {
		if (!loadArduinoConfiguration()) {
			return false;
		}

		if (!arduinoProject.getBoard()) {
			window.showErrorMessage('Select a board first');
			return;
		}

		await window.withProgress({
			location: ProgressLocation.Notification,
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
						window.showInformationMessage('Unable to retrieve board configuration.');
						return;
					}

					const columnToShowIn = window.activeTextEditor
						? window.activeTextEditor.viewColumn
						: undefined;

					if (boardConfigWebViewPanel) {
						boardConfigWebViewPanel.reveal(columnToShowIn);
					} else {
						boardConfigWebViewPanel = window.createWebviewPanel(
							'boardConfig',
							'Arduino Board Configuration',
							columnToShowIn || ViewColumn.One,
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
					window.showErrorMessage('Failed to retrieve board configuration.');
				}
			} catch (error) {
				window.showErrorMessage(`Error retrieving board configuration: ${error}`);
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

		option.values.forEach((value: any) => {
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


function vsCommandPort(): Disposable {
	return commands.registerCommand('vscode-arduino.port', async () => {
		if (!loadArduinoConfiguration()) {
			return;
		}

		await window.withProgress({
			location: ProgressLocation.Notification,
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
						window.showInformationMessage('No ports detected.');
						return;
					}

					// Create QuickPick items from the list of detected ports
					const portItems = ports.map((port: any) => ({
						label: port.port.label,
						description: port.port.protocol_label
					}));

					// Show the QuickPick to the user
					const selectedPort = await window.showQuickPick(portItems, {
						placeHolder: 'Select a port to use for uploading'
					});

					if (selectedPort) {
						window.showInformationMessage(`Selected port: ${selectedPort.label}`);
						// Set the selected port in your project settings or wherever needed
						arduinoProject.setPort(selectedPort.label);
					} else {
						window.showInformationMessage('No port selected.');
					}
				} else {
					window.showErrorMessage('Failed to retrieve port list.');
				}
			} catch (error) {
				window.showErrorMessage(`Error retrieving port list: ${error}`);
			}
		});
	});

}


function vsCommandUpload(): Disposable {
	return commands.registerCommand('vscode-arduino.upload', () => {
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showInformationMessage('Board info not found, cannot upload');
		}
		if (!arduinoProject.getConfiguration()) {
			window.showInformationMessage('Board configuration not found, cannot upload');
		}
		if (!arduinoProject.getPort()) {
			window.showInformationMessage('Port not found, cannot upload');
		}

		// Execute the Arduino CLI command
		const uploadCommand = arduinoProject.getUploadArguments();
		const output = executeArduinoCommand(`${cliCommandArduino}`, uploadCommand, true);

	});
}

function vsCommandCompile(): Disposable {
	return commands.registerCommand('vscode-arduino.compile', () => {
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showInformationMessage('Board info not found, cannot compile');
		}
		if (!arduinoProject.getConfiguration()) {
			window.showInformationMessage('Board configuration not found, cannot compile');
		}
		if (!arduinoProject.getOutput()) {
			window.showInformationMessage('Output not found, cannot compile');
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
				window.showErrorMessage(`Failed to generate c_cpp_properties.json: ${error}`);
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
				window.showErrorMessage(`Command failed with code ${code}. Check Output window for details.`);
				reject(`Command failed with code ${code}`);
			}
		});

		// Handle error event in case the command fails to start
		child.on('error', (err: any) => {
			window.showErrorMessage(`Failed to run command: ${err.message}`);
			reject(`Failed to run command: ${err.message}`);
		});
	});
}

export function deactivate() { }

