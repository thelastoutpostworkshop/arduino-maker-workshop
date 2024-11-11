import { window, ExtensionContext, commands, Disposable, workspace, Uri, OutputChannel } from "vscode";
import { ArduinoProject } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { QuickAccessProvider } from './quickAccessProvider';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoBoardsListPayload, WebviewToExtensionMessage } from "./shared/messages";

const cp = require('child_process');
const path = require('path');

const cliPathSetting: string = "cli.path";
const addtionalBoardURLSetting: string = "additionalBoardsUrl";

const outputChannel = window.createOutputChannel('Arduino CLI');
const compileUploadChannel = window.createOutputChannel('Arduino Compile & Upload');
export const arduinoExtensionChannel = window.createOutputChannel('Arduino Extension');
arduinoExtensionChannel.appendLine("Arduino Extension started");

export const arduinoProject: ArduinoProject = new ArduinoProject();
let cliCommandArduinoPath: string = "";
export let arduinoConfigurationLastError: ARDUINO_ERRORS = ARDUINO_ERRORS.NO_ERRORS;

export function activate(context: ExtensionContext) {
	const config = workspace.getConfiguration();
	cliCommandArduinoPath = config.get<string>(cliPathSetting, "");
	arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${cliCommandArduinoPath}`);

	const boardsURLS = config.get<string>(addtionalBoardURLSetting, "");
	arduinoProject.setAdditionalBoardURLs(boardsURLS);
	arduinoExtensionChannel.appendLine(`Arduino Board URLs: ${arduinoProject.getAdditionalBoardURLs()}`);

	const quickAccessProvider = new QuickAccessProvider();
	window.registerTreeDataProvider('quickAccessView', quickAccessProvider);

	workspace.onDidChangeWorkspaceFolders(() => {
		quickAccessProvider.refresh(); 
	});

	workspace.onDidSaveTextDocument(() => {
		quickAccessProvider.refresh(); 
	});

	// Check if the current folder is a valid Arduino project
	if (arduinoProject.isFolderArduinoProject() !== ARDUINO_ERRORS.NO_ERRORS) {
		quickAccessProvider.refresh();
	}

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(cliPathSetting)) {
				cliCommandArduinoPath = workspace.getConfiguration().get<string>(cliPathSetting, '');
				arduinoExtensionChannel.appendLine(`Arduino CLI Path Changed: ${cliCommandArduinoPath}`);
				checkArduinoCLICommand().then((result) => {
					VueWebviewPanel.sendMessage(processArduinoCLICommandCheck(result));
				});
			}
		})
	);

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(addtionalBoardURLSetting)) {
				const urls = workspace.getConfiguration().get<string>(addtionalBoardURLSetting, '');
				arduinoProject.setAdditionalBoardURLs(urls);
				arduinoExtensionChannel.appendLine(`Arduino Addtional Board URLs Changed: ${arduinoProject.getAdditionalBoardURLs()}`);
			}
		})
	);

	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandUpload());

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
						getCoreUpdate();
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

export async function createNewSketch(name: string): Promise<string> {
	try {
		// Get the current workspace folder (assumes that there's an active workspace)
		if (!workspace.workspaceFolders) {
			throw new Error('No workspace folder is open. Please open a folder first.');
		}

		const currentDirectory = workspace.workspaceFolders[0].uri.fsPath;
		const fullName = path.join(currentDirectory, name);

		// Use the full name (current directory + sketch name)
		const args = arduinoProject.getNewSketchArguments(fullName);
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, args, true, false);

		if (!result) {
			window.showErrorMessage(`CLI: No result from create new sketch`);
			throw new Error("Command result empty");
		}

		// Open the new sketch folder in Visual Studio Code
		const newProjectUri = Uri.file(fullName);
		await commands.executeCommand('vscode.openFolder', newProjectUri, { forceNewWindow: false });

		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI: Failed to create new sketch - ${error.message}`);
		throw error;
	}
}
export async function getOutdatedBoardAndLib(): Promise<string> {
	try {
		const outdatedArgs = arduinoProject.getOutdatedArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, outdatedArgs, true, false);
		if (!result) {
			window.showErrorMessage(`CLI : No result from outdated Board and Libraries information`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Failed to get outdated Board and Libraries information`);
		throw error;
	}
}
export async function searchCore(): Promise<string> {
	try {
		const searchCoreArgs = arduinoProject.getCoreSearchArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, searchCoreArgs, true, false);
		if (!result) {
			window.showErrorMessage(`CLI : No result from search core`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from search core`);
		throw error;
	}
}

export async function searchLibrary(): Promise<string> {
	try {
		const searchLibraryArgs = arduinoProject.getLibrarySearchArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, searchLibraryArgs, true, false);
		if (!result) {
			window.showErrorMessage(`CLI : No result from library search`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from library search`);
		throw error;
	}
}
export async function searchLibraryInstalled(): Promise<string> {
	try {
		const searchLibraryArgs = arduinoProject.getLibraryInstalledArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, searchLibraryArgs, true, false);
		if (!result) {
			window.showErrorMessage(`CLI : No result from library installed`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from library installed`);
		throw error;
	}
}

export async function runInstallLibraryVersion(library: string): Promise<string> {
	try {
		const args = arduinoProject.getInstallLibraryVersionArguments(library);
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, args, true, true);
		if (!result) {
			window.showErrorMessage(`CLI : No result from library version installation`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from library version installation`);
		throw error;
	}
}
export async function runInstallCoreVersion(board_id: string): Promise<string> {
	try {
		const coreUninstallVersionArgs = arduinoProject.getInstallCoreVersionArguments(board_id);
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, coreUninstallVersionArgs, true, true);
		if (!result) {
			window.showErrorMessage(`CLI : No result from core version installation`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from core version installation`);
		throw error;
	}
}
export async function runUninstallCoreVersion(version: string): Promise<string> {
	try {
		const coreInstallVersionArgs = arduinoProject.getUninstallCoreArguments(version);
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, coreInstallVersionArgs, true, true);
		if (!result) {
			window.showErrorMessage(`CLI : No result from core uninstall`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from core uninstall`);
		throw error;
	}
}

export async function getCoreUpdate(): Promise<string> {
	try {
		const coreUpdateArgs = arduinoProject.getCoreUpdateArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, coreUpdateArgs, true, false);
		if (!result) {
			window.showErrorMessage(`CLI : No result from core update`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from core update`);
		throw error;
	}
}

export async function getBoardConfiguration(): Promise<string> {
	try {
		if (!loadArduinoConfiguration()) {
			window.showErrorMessage(`Unable to load Project Configuration`);
			throw new Error("Unable to load Project Configuration");
		}
		if (!arduinoProject.getBoard()) {
			window.showErrorMessage(`Unable to get Board Configuration`);
			throw new Error("Unable to get Board Configuration");
		}
		const configBoardArgs = arduinoProject.getBoardConfigurationArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, configBoardArgs, true, false);

		if (!result) {
			window.showErrorMessage(`CLI : No result from get board configuration`);
			throw new Error("Command result empty");
		}
		return result;

	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from get board configuration`);
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

export async function getBoardsListAll(): Promise<string> {
	try {
		const allBoardArgs = arduinoProject.getBoardsListArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, allBoardArgs, true, false);
		if (!result) {
			window.showErrorMessage(`No result from getting Boards list`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`Failed to get boards list`);
		throw error;
	}
}

export async function getBoardConnected(): Promise<string> {
	try {
		const allBoardArgs = arduinoProject.getBoardConnected();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, allBoardArgs, true, false);
		if (!result) {
			window.showErrorMessage(`No result from getting Boards list`);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`Failed to get boards list`);
		throw error;
	}
}

export async function getBoardsListAll_old(): Promise<ArduinoBoardsListPayload> {
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
			window.showErrorMessage(`CLI : No result from get board list`);
			throw new Error("Command result empty");
		}

		const boardList = JSON.parse(result).boards;

		const boardStructure: { [platform: string]: { name: string, fqbn: string }[] } = {};
		const uniqueFqbnSet = new Set<string>();

		boardList.forEach((board: any) => {
			const platformName = board.platform.release.name; // Get the platform release name

			if (!boardStructure[platformName]) {
				boardStructure[platformName] = [];
			}

			board.platform.release.boards.forEach((boardInfo: any) => {
				const { name, fqbn } = boardInfo;

				if (!uniqueFqbnSet.has(fqbn)) {
					uniqueFqbnSet.add(fqbn);
					boardStructure[platformName].push({ name, fqbn });
				}
			});
		});

		message.boardStructure = boardStructure;
	} catch (error: any) {
		message.errorMessage = error.message;
		window.showErrorMessage(`CLI : Error from get board list`);
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

		const uploadCommand = arduinoProject.getUploadArguments();
		const output = executeArduinoCommand(`${cliCommandArduinoPath}`, uploadCommand, true, true,compileUploadChannel);

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

		const compileCommand = arduinoProject.getCompileCommandArguments();
		executeArduinoCommand(`${cliCommandArduinoPath}`, compileCommand, true, true,compileUploadChannel)
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

export function executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = outputChannel): Promise<string | void> {
	// outputChannel.clear();
	if (showOutput) {
		channel.show(true);
	}
	channel.appendLine('');
	channel.appendLine('Running Arduino CLI...');
	channel.appendLine(`${command}`);
	channel.appendLine(args.join(' '));

	const child = cp.spawn(`${command}`, args);
	let outputBuffer = '';  

	return new Promise((resolve, reject) => {
		// Stream stdout to the output channel and optionally to the buffer
		child.stdout.on('data', (data: Buffer) => {
			const output = data.toString();
			if (showOutput) {
				channel.append(output);
			}

			if (returnOutput) {
				outputBuffer += output;
			}
		});

		// Stream stderr to the output channel and optionally to the buffer
		child.stderr.on('data', (data: Buffer) => {
			const error = `Error: ${data.toString()}`;
			if (showOutput) {
				channel.appendLine(error);
			}
			if (returnOutput) {
				outputBuffer += error;
			}
		});

		child.on('close', (code: number) => {
			if (code === 0) {
				if (showOutput) {
					channel.appendLine('Command executed successfully.');
				}
				resolve(returnOutput ? outputBuffer : undefined);
			} else {
				channel.appendLine(`Command failed with code ${code}.`);
				reject(`Command failed with code ${code}`);
			}
		});

		child.on('error', (err: any) => {
			channel.appendLine(`Failed to run command: ${err.message}`);
			reject(`Failed to run command: ${err.message}`);
		});
	});
}

export function deactivate() { }

