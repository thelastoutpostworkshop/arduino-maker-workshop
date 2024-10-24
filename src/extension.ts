import { window, ExtensionContext, commands, Disposable, workspace } from "vscode";
import { ARDUINO_ERRORS, ArduinoProject } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { QuickAccessProvider } from './quickAccessProvider';
import { ARDUINO_MESSAGES, ArduinoBoardsListPayload, WebviewToExtensionMessage } from "./shared/messages";

const cp = require('child_process');

const outputChannel = window.createOutputChannel('Arduino');
export const arduinoExtensionChannel = window.createOutputChannel('Arduino.Extension');
arduinoExtensionChannel.appendLine("Arduino Extension started");

export const arduinoProject: ArduinoProject = new ArduinoProject();
let cliCommandArduinoPath: string = "";
export let arduinoConfigurationLastError: ARDUINO_ERRORS = ARDUINO_ERRORS.NO_ERRORS;

export function activate(context: ExtensionContext) {

	// Read the arduino-cli path setting
	const config = workspace.getConfiguration();
	cliCommandArduinoPath = config.get<string>('cli.path', "");
	arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${cliCommandArduinoPath}`);

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('cli.path')) {
				cliCommandArduinoPath = workspace.getConfiguration().get<string>('cli.path', '');
				arduinoExtensionChannel.appendLine(`Arduino CLI Path Changed: ${cliCommandArduinoPath}`);
				checkArduinoCLICommand().then((result) => {
					VueWebviewPanel.sendMessage(processArduinoCLICommandCheck(result));
				});
			}
		})
	);

	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandUpload());

	const quickAccessProvider = new QuickAccessProvider();
	window.registerTreeDataProvider('quickAccessView', quickAccessProvider);

	context.subscriptions.push(
		commands.registerCommand('extension.openVueWebview', () => {
			VueWebviewPanel.render(context.extensionUri);
		})
	);
}

export function processArduinoCLICommandCheck(commandResult: string): WebviewToExtensionMessage {
	let message: string = "";
	if (commandResult === "") {
		message = "Arduino CLI Path wrong or not set in settings";
	}
	const cliStatusMessage: WebviewToExtensionMessage = {
		command: ARDUINO_MESSAGES.CLI_STATUS,
		errorMessage: message,
		payload: commandResult
	};
	return cliStatusMessage
}

export function checkArduinoCLICommand(): Promise<string> {
	return new Promise((resolve) => {
		if (cliCommandArduinoPath === '') {
			window.showErrorMessage('Arduino CLI Path not set in your settings');
			resolve("");
			return;
		}

		const arduinoVersionArgs = arduinoProject.getVersionArguments();

		executeArduinoCommand(`${cliCommandArduinoPath}`, arduinoVersionArgs, true, false)
			.then((result) => {
				if (result) {
					try {
						resolve(result);
					} catch (parseError) {
						arduinoExtensionChannel.appendLine('Failed to get Arduino CLI version information.');
						window.showErrorMessage(`Failed to get Arduino CLI version information.`);
						resolve("");
					}
				} else {
					window.showErrorMessage(`No result returned by checking the CLI version`);
					resolve("");
				}
			})
			.catch((error) => {
				window.showErrorMessage(`Arduino CLI path is wrong in your settings: ${error}`);
				resolve("");
			});
	});
}

export async function getOutdatedBoardAndLib(): Promise<string> {
	try {
		const outdatedArgs = arduinoProject.getOutdatedArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, outdatedArgs, true, false);
		if (!result) {
			window.showErrorMessage(`No result from outdated Board and Libraries information`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`Failed to get outdated Board and Libraries information`);
		arduinoExtensionChannel.appendLine(`Error: ${error.message}`);
		throw error;
	}
}
export async function runInstallCoreVersion(version:string): Promise<string> {
	try {
		const coreInstallVersionArgs = arduinoProject.getInstallCoreVersionArguments(version);
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, coreInstallVersionArgs, true, true);
		if (!result) {
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		arduinoExtensionChannel.appendLine(`Error: ${error.message}`);
		throw error;
	}
}

export async function getCoreUpdate(): Promise<string> {
	try {
		const coreUpdateArgs = arduinoProject.getCoreUpdateArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, coreUpdateArgs, true, false);
		if (!result) {
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		arduinoExtensionChannel.appendLine(`Error: ${error.message}`);
		throw error;
	}
}

export async function getBoardConfiguration(): Promise<string> {
	try {
		if (!loadArduinoConfiguration()) {
			throw new Error("Unable to load Project Configuration");
		}
		if (!arduinoProject.getBoard()) {
			throw new Error("Unable to get Board Configuration");
		}
		const configBoardArgs = arduinoProject.getBoardConfigurationArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, configBoardArgs, true, false);

		if (!result) {
			throw new Error("Command result empty");
		}

		return result;

	} catch (error: any) {
		arduinoExtensionChannel.appendLine(`Error: ${error.message}`);
		throw error;
	}
}

export function loadArduinoConfiguration(): boolean {

	arduinoConfigurationLastError = arduinoProject.isFolderArduinoProject();
	if (arduinoConfigurationLastError !== ARDUINO_ERRORS.NO_ERRORS) {
		let message: string = "";
		switch (arduinoConfigurationLastError) {
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

export async function getBoardsListAll(): Promise<ArduinoBoardsListPayload> {
	const message: ArduinoBoardsListPayload = {
		errorMessage: "",
		boardStructure: undefined,
	};

	try {
		if (!loadArduinoConfiguration()) {
			throw new Error("Unable to load Project Configuration");
		}

		if (!arduinoProject.getBoard()) {
			throw new Error("Unable to get Project Board");
		}

		const allBoardArgs = arduinoProject.getBoardsListArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, allBoardArgs, true, false);

		if (!result) {
			throw new Error("Command result empty");
		}

		// Parse board list
		const boardList = JSON.parse(result).boards;

		// Initialize an empty object to hold the structured board data
		const boardStructure: { [platform: string]: { name: string, fqbn: string }[] } = {};
		const uniqueFqbnSet = new Set<string>();

		boardList.forEach((board: any) => {
			const platformName = board.platform.release.name; // Get the platform release name

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

		message.boardStructure = boardStructure;
	} catch (error: any) {
		message.errorMessage = error.message;
		arduinoExtensionChannel.appendLine(`Error: ${error.message}`);
	}

	return message;
}

function vsCommandUpload(): Disposable {
	return commands.registerCommand('quickAccessView.upload', () => {
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showInformationMessage('Board info not found, cannot upload');
		}
		if (!arduinoProject.getBoardConfiguration()) {
			window.showInformationMessage('Board configuration not found, cannot upload');
		}
		if (!arduinoProject.getPort()) {
			window.showInformationMessage('Port not found, cannot upload');
		}

		// Execute the Arduino CLI command
		const uploadCommand = arduinoProject.getUploadArguments();
		const output = executeArduinoCommand(`${cliCommandArduinoPath}`, uploadCommand, true);

	});
}

function vsCommandCompile(): Disposable {
	return commands.registerCommand('quickAccessView.compile', () => {
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showInformationMessage('Board info not found, cannot compile');
		}
		if (!arduinoProject.getBoardConfiguration()) {
			window.showInformationMessage('Board configuration not found, cannot compile');
		}
		if (!arduinoProject.getOutput()) {
			window.showInformationMessage('Output not found, cannot compile');
		}

		// Execute the Arduino CLI command
		const compileCommand = arduinoProject.getCompileCommandArguments();
		executeArduinoCommand(`${cliCommandArduinoPath}`, compileCommand, true)
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
	arduinoExtensionChannel.appendLine('Running Arduino CLI...');
	arduinoExtensionChannel.appendLine(`${command}`);
	arduinoExtensionChannel.appendLine(args.join(' '));

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
				arduinoExtensionChannel.appendLine(`Command failed with code ${code}. Check Output window for details.`);
				reject(`Command failed with code ${code}`);
			}
		});

		// Handle error event in case the command fails to start
		child.on('error', (err: any) => {
			arduinoExtensionChannel.appendLine(`Failed to run command: ${err.message}`);
			reject(`Failed to run command: ${err.message}`);
		});
	});
}

export function deactivate() { }

