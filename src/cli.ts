import { commands, OutputChannel, Uri, window,workspace,ExtensionContext } from "vscode";
import { arduinoCLIChannel, arduinoProject, cliCommandArduinoPath } from "./extension";
const cp = require('child_process');
const path = require('path');
const os = require('os');

function getAppDataPath(): string {
	const platform = os.platform();
	const homeDir = os.homedir();

	if (platform === 'win32') {
		// Windows - return paths for %APPDATA% and %LOCALAPPDATA%
		const localAppDataPath = path.join(homeDir, 'AppData', 'Local');
		return `${localAppDataPath}`;
	} else if (platform === 'linux' || platform === 'darwin') {
		// macOS or Linux - return path for ~/.config
		const configPath = path.join(homeDir, '.config');
		return configPath;
	} else {
		throw new Error('Unsupported platform');
	}
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