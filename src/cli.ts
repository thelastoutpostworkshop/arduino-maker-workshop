import { commands, OutputChannel, Uri, window, workspace, ExtensionContext } from "vscode";
import { arduinoCLI, arduinoCLIChannel, arduinoExtensionChannel, arduinoProject, cliCommandArduinoPath } from "./extension";
import { ArduinoCLIStatus } from "./shared/messages";
const cp = require('child_process');
const path = require('path');
const os = require('os');

export class ArduinoCLI {
	public async getOutdatedBoardAndLib(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getOutdatedArguments(),
			"CLI : Failed to get outdated Board and Libraries information"
		);
	}
	public async searchLibraryInstalled(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getLibraryInstalledArguments(),
			"CLI: Failed to get library installed"
		);
	}
	public async  getCLIConfig(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getConfigDumpArgs(),
			"CLI : Failed to get CLI Config information"
		);
	}
	
	public async removeCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getConfigRemoveAdditionalBoardURLArgs(URL),
			"CLI : Failed to delete additional Board URL", false
		);
	}
	
	public async addCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getConfigAddAdditionalBoardURLArgs(URL),
			"CLI : Failed to add additional Board URL", false
		);
	}
	
	public async setCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getConfigSetAdditionalBoardURLArgs(URL),
			"CLI : Failed to set additional Board URL", false
		);
	}
	public async searchCore(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getCoreSearchArguments(),
			"CLI: Failed to get boards available"
		);
	}
	
	public async searchLibrary(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getLibrarySearchArguments(),
			"CLI: Failed to get library available"
		);
	}
	
	public async runInstallLibraryVersion(library: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getInstallLibraryVersionArguments(library),
			"CLI: Failed to install library", true, true
		);
	}
	
	public async runInstallCoreVersion(board_id: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getInstallCoreVersionArguments(board_id),
			"CLI: Failed to install board", true, true
		);
	}
	
	public async runUninstallLibrary(version: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getUninstallLibraryArguments(version),
			"CLI: Failed to remove library", true, true
		);
	}
	
	public async runUninstallCoreVersion(version: string): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getUninstallCoreArguments(version),
			"CLI: Failed to remove board", true, true
		);
	}
	
	public async getCoreUpdate(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getCoreUpdateArguments(),
			"CLI: Failed to get board update information"
		);
	}
	public async getBoardsListAll(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getBoardsListArguments(),
			"CLI: Failed to get boards list "
		);
	}
	
	public async getBoardConnected(): Promise<string> {
		return runArduinoCommand(
			() => arduinoProject.getBoardConnectedArguments(),
			"CLI: Failed to get Boards "
		);
	}
}


export function checkArduinoCLICommand(): Promise<ArduinoCLIStatus> {
	return new Promise((resolve) => {
		const arduinoVersionArgs = arduinoProject.getVersionArguments();

		executeArduinoCommand(`${cliCommandArduinoPath}`, arduinoVersionArgs, true, false)
			.then((result) => {
				if (result) {
					try {
						arduinoCLI.getCoreUpdate();
						resolve(JSON.parse(result));
					} catch (parseError) {
						arduinoExtensionChannel.appendLine('Failed to get Arduino CLI version information.');
						window.showErrorMessage(`Failed to get Arduino CLI version information.`);
						resolve({
							VersionString: "unknown",
							Date: 'CLI Error'
						});
					}
				} else {
					window.showErrorMessage(`No result returned by checking the CLI version`);
					resolve({
						VersionString: "unknown",
						Date: 'CLI Error'
					});
				}
			})
			.catch((error) => {
				window.showErrorMessage(`Arduino CLI path is wrong in your settings: ${error}`);
				resolve({
					VersionString: "unknown",
					Date: 'CLI Error'
				});
			});
	});
}

export function getArduinoCliPath(context: ExtensionContext): string {
	const platform = os.platform();
	let arduinoCliPath = '';

	switch (platform) {
		case 'win32':
			arduinoCliPath = path.join(context.extensionPath, 'arduino_cli', 'win32', 'arduino-cli.exe');
			break;
		case 'darwin':
			arduinoCliPath = path.join(context.extensionPath, 'arduino_cli', 'darwin', 'arduino-cli');
			break;
		case 'linux':
			arduinoCliPath = path.join(context.extensionPath, 'arduino_cli', 'linux', 'arduino-cli');
			break;
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}

	return arduinoCliPath;
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

export async function runArduinoCommand(
	getArguments: () => string[],
	errorMessagePrefix: string,
	returnOutput: boolean = true,
	showOutput: boolean = false,
	channel: OutputChannel = arduinoCLIChannel,
	successMSG: string = ""
): Promise<string> {
	try {
		const args = getArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, args, returnOutput, showOutput, channel, successMSG);
		if (!result && returnOutput) {
			const errorMsg = `${errorMessagePrefix}: No result`;
			window.showErrorMessage(errorMsg);
			throw new Error("Command result empty");
		}
		return result || '';
	} catch (error: any) {
		window.showErrorMessage(`${errorMessagePrefix}`);
		throw error;
	}
}

export function executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = arduinoCLIChannel, successMsg: string = ""): Promise<string | void> {
	// outputChannel.clear();
	if (showOutput) {
		channel.show(true);
	}
	arduinoCLIChannel.appendLine('');
	arduinoCLIChannel.appendLine('Running Arduino CLI...');
	arduinoCLIChannel.appendLine(`${command}`);
	arduinoCLIChannel.appendLine(args.join(' '));

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
				if (successMsg) {
					window.showInformationMessage(successMsg);
				}
				resolve(returnOutput ? outputBuffer : undefined);
			} else {
				channel.appendLine(`Command failed with code ${code}.`);
				reject(undefined);
			}
		});

		child.on('error', (err: any) => {
			channel.appendLine(`Failed to run command: ${err.message}`);
			reject(undefined);
		});
	});
}