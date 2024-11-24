import { window, ExtensionContext, commands, Disposable, workspace, Uri, OutputChannel, ProgressLocation } from "vscode";
import { ArduinoProject, CPP_PROPERTIES, VSCODE_FOLDER } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { compileCommandCleanName, compileCommandName, intellisenseCommandName, QuickAccessProvider, uploadCommandName } from './quickAccessProvider';
import { ARDUINO_ERRORS, ArduinoCLIStatus, ArduinoConfig, Compile } from "./shared/messages";
import { SerialMonitorApi, Version, getSerialMonitorApi, LineEnding, Parity, StopBits } from '@microsoft/vscode-serial-monitor-api';

const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const arduinoCLIChannel = window.createOutputChannel('Arduino CLI');
const compileUploadChannel = window.createOutputChannel('Arduino Compile & Upload');
export const arduinoExtensionChannel = window.createOutputChannel('Arduino Extension');
arduinoExtensionChannel.appendLine("Arduino Extension started");
const quickAccessProvider = new QuickAccessProvider();
let serialMoniorAPI: SerialMonitorApi | undefined = undefined;
let compileOrUploadRunning: boolean = false;

export const arduinoProject: ArduinoProject = new ArduinoProject();
let cliCommandArduinoPath: string = "";

export function activate(context: ExtensionContext) {
	const config = workspace.getConfiguration();
	try {
		cliCommandArduinoPath = getArduinoCliPath(context);
		arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${cliCommandArduinoPath}`);
	} catch (error: any) {
		arduinoExtensionChannel.appendLine(error);
		window.showErrorMessage(error);
		throw new Error(error);
	}

	checkArduinoConfiguration();

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
		})
	);

	context.subscriptions.push(
		workspace.onDidChangeConfiguration((e) => {
		})
	);

	context.subscriptions.push(vsCommandCompile());
	context.subscriptions.push(vsCommandCompileClean());
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

function checkArduinoConfiguration() {
	runArduinoCommand(
		() => arduinoProject.getConfigDumpArgs(),
		"CLI : Failed to get arduino configuration information"
	).then((result) => {
		try {
			const config: ArduinoConfig = JSON.parse(result);
			if (Object.keys(config.config).length === 0) {
				// There is no arduino config file, let's create one
				runArduinoCommand(
					() => arduinoProject.getConfigInitArgs(),
					"CLI : Failed to create arduino config file",
					true, false
				).then((result) => {
					try {
						const config = JSON.parse(result);
						const configPath = path.dirname(config.config_path);
						const downloadPath = path.join(configPath, 'staging');
						runArduinoCommand(
							() => arduinoProject.getConfigSetDowloadDirectory(downloadPath),
							"CLI : Failed to set download directory setting",
							false, false
						).then(() => {
							runArduinoCommand(
								() => arduinoProject.getConfigSetDataDirectory(configPath),
								"CLI : Failed to set data directory setting",
								false, false
							).then(()=>{
								const arduinoDir = path.join(getDocumentsFolderPath(),'Arduino');
								runArduinoCommand(
									() => arduinoProject.getConfigSetUserDirectory(arduinoDir),
									"CLI : Failed to set user directory setting",
									false, false
								);							});
						});
					} catch (error) {
						window.showErrorMessage(`Error parsing config file ${error}`);
					}
				}).catch((error) => {
					window.showErrorMessage(`Error creating config file ${error}`);
				});
			}
		} catch (error) {
			window.showErrorMessage(`Someting is wrong with the CLI ${error}`);
		}
	}).catch((error) => {
		window.showErrorMessage(`${error}`);
	});
}

function getDocumentsFolderPath() {
	const homeDir = os.homedir(); // Get the user's home directory
  
	switch (os.platform()) {
	  case 'win32':
		return path.join(homeDir, 'Documents'); // Windows path to Documents
	  case 'linux':
	  case 'darwin':
		return path.join(homeDir, 'Documents'); // Linux and macOS path to Documents
	  default:
		throw new Error('Unsupported platform');
	}
  }

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

function updateStateCompileUpload() {
	arduinoProject.readConfiguration();
	if (arduinoProject.isFolderArduinoProject() === ARDUINO_ERRORS.NO_ERRORS &&
		arduinoProject.getArduinoConfiguration().board.trim() !== '' &&
		arduinoProject.getArduinoConfiguration().configuration.trim() !== '') {
		quickAccessProvider.enableItem(compileCommandName);
		quickAccessProvider.enableItem(compileCommandCleanName);
		quickAccessProvider.enableItem(uploadCommandName);
		quickAccessProvider.enableItem(intellisenseCommandName);
	} else {
		quickAccessProvider.disableItem(compileCommandName);
		quickAccessProvider.disableItem(compileCommandCleanName);
		quickAccessProvider.disableItem(uploadCommandName);
		quickAccessProvider.disableItem(intellisenseCommandName);
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

export function openExample(examplePath: string) {
	const uriPath = Uri.file(examplePath);
	commands.executeCommand('vscode.openFolder', uriPath, { forceNewWindow: true });
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

export async function getCLIConfig(): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getConfigDumpArgs(),
		"CLI : Failed to get CLI Config information"
	);
}

export async function removeCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getConfigRemoveAdditionalBoardURLArgs(URL),
		"CLI : Failed to delete additional Board URL", false
	);
}

export async function addCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getConfigAddAdditionalBoardURLArgs(URL),
		"CLI : Failed to add additional Board URL", false
	);
}

export async function setCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
	return runArduinoCommand(
		() => arduinoProject.getConfigSetAdditionalBoardURLArgs(URL),
		"CLI : Failed to set additional Board URL", false
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
		updateStateCompileUpload();
		return result;

	} catch (error: any) {
		window.showErrorMessage(`CLI : Error from get board configuration, you may have to installed the board using the board manager`);
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
	return commands.registerCommand('quickAccessView.upload', async () => {
		if (compileOrUploadRunning) {
			compileUploadChannel.show();
			return;
		}
		compileUploadChannel.appendLine("Upload starting...");
		compileOrUploadRunning = true;
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

		if (serialMoniorAPI) {
			const port = arduinoProject.getPort();
			serialMoniorAPI.stopMonitoringPort(port);
		}
		await runArduinoCommand(
			() => arduinoProject.getUploadArguments(),
			"CLI: Failed to upload", false, true, compileUploadChannel
		);
		if (serialMoniorAPI) {
			serialMoniorAPI.startMonitoringPort({ port: arduinoProject.getPort(), baudRate: 115200, lineEnding: LineEnding.None, dataBits: 8, stopBits: StopBits.One, parity: Parity.None }).then((port) => {
			});
		}
		compileOrUploadRunning = false;
	});
}

function vsGenerateIntellisense(): Disposable {
	return commands.registerCommand('intellisense', () => {
		generateIntellisense();
	});
}

function generateIntellisense() {
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

	window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Generating IntelliSense Configuration...",
			cancellable: false
		}, async (progress) => {
			const output = await runArduinoCommand(
				() => arduinoProject.getCompileCommandArguments(true),
				"CLI: Failed to compile for intellisense", true, false, compileUploadChannel
			);
			if (output) {
				createIntellisenseFile(output);
			}
		});

}

function createIntellisenseFile(compileJsonOutput: string) {
	try {
		const compileInfo: Compile = JSON.parse(compileJsonOutput);

		// Extract include paths from used libraries
		const includePaths = new Set<string>();
		if (compileInfo.builder_result.used_libraries) {
			compileInfo.builder_result.used_libraries.forEach(library => {
				includePaths.add(`${library.source_dir}/**`); // Add recursive include
			});
		}

		// Add core paths (e.g., ESP32 core and variant paths)
		const corePath = compileInfo.builder_result.build_platform.install_dir;
		includePaths.add(`${corePath}/**`);

		// Extract defines
		const defines = compileInfo.builder_result.build_properties
			.filter(prop => prop.startsWith("-D"))
			.map(prop => prop.substring(2)); // Remove "-D" prefix

		// Extract compiler path if available
		const compilerPathProperty = compileInfo.builder_result.build_properties.find(prop =>
			prop.startsWith("compiler.path")
		);
		const compilerPath = compilerPathProperty
			? compilerPathProperty.split("=")[1].trim() // Extract the path
			: "/path/to/compiler"; // Default placeholder if not found

		// Extract compiler path if available
		const compilerCommand = compileInfo.builder_result.build_properties.find(prop =>
			prop.startsWith("compiler.cpp.cmd")
		);
		const compilerName = compilerCommand
			? compilerCommand.split("=")[1].trim() // Extract the path
			: "(compiler name)"; // Default placeholder if not found

		// Create c_cpp_properties.json
		const cppProperties = {
			configurations: [
				{
					name: "Arduino",
					includePath: Array.from(includePaths),
					defines: defines,
					compilerPath: `${compilerPath}/${compilerName}`,
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

function vsCommandCompileClean(): Disposable {
	return commands.registerCommand('compile.clean', async () => {
		compile(true);
	});
}
function vsCommandCompile(clean: boolean = false): Disposable {
	return commands.registerCommand('quickAccessView.compile', async () => {
		compile(false);
	});
}

async function compile(clean: boolean = false) {
	if (compileOrUploadRunning) {
		compileUploadChannel.show();
		return;
	}
	compileOrUploadRunning = true;
	compileUploadChannel.appendLine("Compile project starting...");
	if (!loadArduinoConfiguration()) {
		return;
	}
	if (!arduinoProject.getBoard()) {
		window.showErrorMessage('Board info not found, cannot compile');
	}
	if (!arduinoProject.getBoardConfiguration()) {
		window.showErrorMessage('Board configuration not found, cannot compile');
	}
	if (!arduinoProject.getOutput()) {
		window.showErrorMessage('Output not found, cannot compile');
	}

	try {
		await runArduinoCommand(
			() => arduinoProject.getCompileCommandArguments(false, clean),
			"CLI: Failed to compile project", true, true, compileUploadChannel, "Compilation success!"
		);
		generateIntellisense();
	} catch (error) {
		console.log(error);
	}
	compileOrUploadRunning = false;
}

async function runArduinoCommand(
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

export function deactivate() { }

