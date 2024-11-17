import { window, ExtensionContext, commands, Disposable, workspace, Uri, OutputChannel } from "vscode";
import { ArduinoProject, CPP_PROPERTIES, VSCODE_FOLDER } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { compileCommandName, QuickAccessProvider, uploadCommandName } from './quickAccessProvider';
import { ARDUINO_ERRORS, ArduinoCLIStatus, Compile } from "./shared/messages";
import { SerialMonitorApi, Version, getSerialMonitorApi, LineEnding, Parity, StopBits, Port } from '@microsoft/vscode-serial-monitor-api';

const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const addtionalBoardURLSetting: string = "additionalBoardsUrl";

const arduinoCLIChannel = window.createOutputChannel('Arduino CLI');
const compileUploadChannel = window.createOutputChannel('Arduino Compile & Upload');
export const arduinoExtensionChannel = window.createOutputChannel('Arduino Extension');
arduinoExtensionChannel.appendLine("Arduino Extension started");
const quickAccessProvider = new QuickAccessProvider();
let serialMoniorAPI: SerialMonitorApi | undefined = undefined;


export const arduinoProject: ArduinoProject = new ArduinoProject();
let cliCommandArduinoPath: string = "";

export function activate(context: ExtensionContext) {
	const config = workspace.getConfiguration();
	cliCommandArduinoPath = getArduinoCliPath(context);
	arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${cliCommandArduinoPath}`);

	const boardsURLS = config.get<string>(addtionalBoardURLSetting, "");
	arduinoProject.setAdditionalBoardURLs(boardsURLS);
	arduinoExtensionChannel.appendLine(`Arduino Board URLs: ${arduinoProject.getAdditionalBoardURLs()}`);

	// workspace.onDidChangeWorkspaceFolders(() => {
	// 	quickAccessProvider.refresh();
	// });

	// // Check if the current folder is a valid Arduino project
	// if (arduinoProject.isFolderArduinoProject() !== ARDUINO_ERRORS.NO_ERRORS) {
	// 	quickAccessProvider.refresh();
	// }

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
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
	context.subscriptions.push(vsGenerateIntellisense());

	context.subscriptions.push(
		commands.registerCommand('extension.openVueWebview', () => {
			VueWebviewPanel.render(context.extensionUri);
		})
	);

	window.registerTreeDataProvider('quickAccessView', quickAccessProvider);
	updateStateCompileUpload();
	workspace.onDidChangeTextDocument((document) => {
		if (document.document.fileName === arduinoProject.getarduinoConfigurationPath()) {
			updateStateCompileUpload();
		}
	});
	getSerialMonitorApi(Version.latest, context).then((api) => {
		serialMoniorAPI = api;
	});

}

function updateStateCompileUpload() {
	arduinoProject.readConfiguration();
	if (arduinoProject.isFolderArduinoProject() === ARDUINO_ERRORS.NO_ERRORS &&
		arduinoProject.getArduinoConfiguration().board.trim() !== '' &&
		arduinoProject.getArduinoConfiguration().configuration.trim() !== '') {
		quickAccessProvider.enableItem(compileCommandName);
		quickAccessProvider.enableItem(uploadCommandName);
	} else {
		quickAccessProvider.disableItem(compileCommandName);
		quickAccessProvider.disableItem(uploadCommandName);
	}
}

function getArduinoCliPath(context: ExtensionContext): string {
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


export function checkArduinoCLICommand(): Promise<ArduinoCLIStatus> {
	return new Promise((resolve) => {
		const arduinoVersionArgs = arduinoProject.getVersionArguments();

		executeArduinoCommand(`${cliCommandArduinoPath}`, arduinoVersionArgs, true, false)
			.then((result) => {
				if (result) {
					try {
						getCoreUpdate();
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
	return runArduinoCommand(
		() => arduinoProject.getOutdatedArguments(),
		"CLI : Failed to get outdated Board and Libraries information"
	);
}

export async function searchCore(): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getCoreSearchArguments(),
		"CLI: Failed to get boards available"
	);
}

export async function searchLibrary(): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getLibrarySearchArguments(),
		"CLI: Failed to get library available"
	);
}

export async function searchLibraryInstalled(): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getLibraryInstalledArguments(),
		"CLI: Failed to get library installed"
	);
}

export async function runInstallLibraryVersion(library: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getInstallLibraryVersionArguments(library),
		"CLI: Failed to install library", true, true
	);
}

export async function runInstallCoreVersion(board_id: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getInstallCoreVersionArguments(board_id),
		"CLI: Failed to install board", true, true
	);
}

export async function runUninstallLibrary(version: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getUninstallLibraryArguments(version),
		"CLI: Failed to remove library", true, true
	);
}

export async function runUninstallCoreVersion(version: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getUninstallCoreArguments(version),
		"CLI: Failed to remove board", true, true
	);
}

export async function getCoreUpdate(): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getCoreUpdateArguments(),
		"CLI: Failed to get board update information"
	);
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

	const projectError = arduinoProject.isFolderArduinoProject();
	if (projectError !== ARDUINO_ERRORS.NO_ERRORS) {
		let message: string = "";
		switch (projectError) {
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
	return runArduinoCommand(
		() => arduinoProject.getBoardsListArguments(),
		"CLI: Failed to get boards list "
	);
}

export async function getBoardConnected(): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getBoardConnectedArguments(),
		"CLI: Failed to get Boards "
	);
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
		if (serialMoniorAPI) {
			const port = arduinoProject.getPort();
			serialMoniorAPI.stopMonitoringPort(port);
		}
		executeArduinoCommand(`${cliCommandArduinoPath}`, uploadCommand, false, true, compileUploadChannel).then(() => {
			if (serialMoniorAPI) {
				serialMoniorAPI.startMonitoringPort({ port: arduinoProject.getPort(), baudRate: 115200, lineEnding: LineEnding.None, dataBits: 8, stopBits: StopBits.One, parity: Parity.None }).then((port) => {
				});
			}
		});

	});
}

function vsGenerateIntellisense(): Disposable {
	return commands.registerCommand('intellisense', () => {
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showInformationMessage('Board info not found, cannot generate intellisense');
		}
		if (!arduinoProject.getBoardConfiguration()) {
			window.showInformationMessage('Board configuration not found, cannot generate intellisense');
		}
		if (!arduinoProject.getOutput()) {
			window.showInformationMessage('Output not found, cannot generate intellisense');
		}

		const compileCommand = arduinoProject.getCompileCommandArguments(true);
		executeArduinoCommand(`${cliCommandArduinoPath}`, compileCommand, true, false, compileUploadChannel)
			.then(output => {
				if (output) {
					// Parse the output and generate c_cpp_properties.json
					createIntellisenseFile(output);
					// arduinoProject.generateCppPropertiesFromCompileOutput(output);
				}
			});
	});
}

function createIntellisenseFile(compileJsonOutput: string) {
    try {
        const compileInfo: Compile = JSON.parse(compileJsonOutput);

        // Extract include paths from used libraries
        const includePaths = new Set<string>();
        compileInfo.builder_result.used_libraries.forEach(library => {
            includePaths.add(library.source_dir);
        });

        // Add core paths (e.g., ESP32 core and variant paths)
        const corePath = compileInfo.builder_result.build_platform.install_dir;
        includePaths.add(`${corePath}/cores/${compileInfo.builder_result.board_platform.id}`);
        includePaths.add(`${corePath}/variants/${compileInfo.builder_result.board_platform.id}`);

        // Extract defines
        const defines = compileInfo.builder_result.build_properties
            .filter(prop => prop.startsWith("-D"))
            .map(prop => prop.substring(2)); // Remove "-D" prefix

        // Extract compiler path if available
        const compilerPathProperty = compileInfo.builder_result.build_properties.find(prop =>
            prop.startsWith("compiler.c.cmd")
        );
        const compilerPath = compilerPathProperty
            ? compilerPathProperty.split("=")[1].trim() // Extract the path
            : "/path/to/compiler"; // Default placeholder if not found

        // Create c_cpp_properties.json
        const cppProperties = {
            configurations: [
                {
                    name: "Arduino",
                    includePath: Array.from(includePaths),
                    defines: defines,
                    compilerPath: compilerPath,
                    cStandard: "c17",
                    cppStandard: "c++17",
                    intelliSenseMode: "gcc-x86"
                }
            ],
            version: 4
        };

        const cppPropertiesPath = path.join(
            arduinoProject.getProjectPath(),
            VSCODE_FOLDER,
            CPP_PROPERTIES
        );
        fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));

        window.showInformationMessage("Generated c_cpp_properties.json for IntelliSense.");
    } catch (error) {
        window.showErrorMessage(`Failed to generate intellisense c_cpp_properties.json: ${error}`);
    }
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
		executeArduinoCommand(`${cliCommandArduinoPath}`, compileCommand, true, true, compileUploadChannel)
			.then(output => {
				if (output) {
					// Parse the output and generate c_cpp_properties.json
					// arduinoProject.generateCppPropertiesFromCompileOutput(output);
				}
			})
			.catch(error => {
				window.showErrorMessage(`Failed to generate c_cpp_properties.json: ${error}`);
			});

	});
}

async function runArduinoCommand(
	getArguments: () => string[],
	errorMessagePrefix: string,
	returnOutput: boolean = true,
	showOutput: boolean = false,
	channel: OutputChannel = arduinoCLIChannel
): Promise<string> {
	try {
		const args = getArguments();
		const result = await executeArduinoCommand(`${cliCommandArduinoPath}`, args, returnOutput, showOutput, channel);
		if (!result) {
			const errorMsg = `${errorMessagePrefix}: No result`;
			window.showErrorMessage(errorMsg);
			throw new Error("Command result empty");
		}
		return result;
	} catch (error: any) {
		window.showErrorMessage(`${errorMessagePrefix}: ${error.message}`);
		throw error;
	}
}

export function executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = arduinoCLIChannel): Promise<string | void> {
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
				resolve(returnOutput ? outputBuffer : undefined);
			} else {
				channel.appendLine(`Command failed with code ${code}.`);
				resolve(undefined);
			}
		});

		child.on('error', (err: any) => {
			channel.appendLine(`Failed to run command: ${err.message}`);
			resolve(undefined);
		});
	});
}

export function deactivate() { }

