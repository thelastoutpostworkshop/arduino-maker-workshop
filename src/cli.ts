import { commands, OutputChannel, Uri, window, workspace, ExtensionContext } from "vscode";
import { arduinoCLI, arduinoCLIChannel, arduinoExtensionChannel, arduinoProject, loadArduinoConfiguration, updateStateCompileUpload } from "./extension";
import { ArduinoCLIStatus, ArduinoConfig } from "./shared/messages";
const cp = require('child_process');
const path = require('path');
const os = require('os');

export class ArduinoCLI {
	public arduinoCLIPath: string = "";
	constructor(private context: ExtensionContext) {
		this.getArduinoCliPath();
	}
	public async getOutdatedBoardAndLib(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getOutdatedArguments(),
			"CLI : Failed to get outdated Board and Libraries information"
		);
	}
	public async searchLibraryInstalled(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getLibraryInstalledArguments(),
			"CLI: Failed to get library installed"
		);
	}
	public async getCLIConfig(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getConfigDumpArgs(),
			"CLI : Failed to get CLI Config information"
		);
	}

	public async removeCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getConfigRemoveAdditionalBoardURLArgs(URL),
			"CLI : Failed to delete additional Board URL", false
		);
	}

	public async addCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getConfigAddAdditionalBoardURLArgs(URL),
			"CLI : Failed to add additional Board URL", false
		);
	}

	public async setCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getConfigSetAdditionalBoardURLArgs(URL),
			"CLI : Failed to set additional Board URL", false
		);
	}
	public async searchCore(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getCoreSearchArguments(),
			"CLI: Failed to get boards available"
		);
	}

	public async searchLibrary(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getLibrarySearchArguments(),
			"CLI: Failed to get library available"
		);
	}

	public async runInstallLibraryVersion(library: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getInstallLibraryVersionArguments(library),
			"CLI: Failed to install library", true, true
		);
	}

	public async runInstallCoreVersion(board_id: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getInstallCoreVersionArguments(board_id),
			"CLI: Failed to install board", true, true
		);
	}

	public async runUninstallLibrary(version: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getUninstallLibraryArguments(version),
			"CLI: Failed to remove library", true, true
		);
	}

	public async runUninstallCoreVersion(version: string): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getUninstallCoreArguments(version),
			"CLI: Failed to remove board", true, true
		);
	}

	public async getCoreUpdate(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getCoreUpdateArguments(),
			"CLI: Failed to get board update information"
		);
	}
	public async getBoardsListAll(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getBoardsListArguments(),
			"CLI: Failed to get boards list "
		);
	}

	public async getBoardConnected(): Promise<string> {
		return this.runArduinoCommand(
			() => arduinoProject.getBoardConnectedArguments(),
			"CLI: Failed to get Boards "
		);
	}
	public checkArduinoConfiguration() {
		this.runArduinoCommand(
			() => arduinoProject.getConfigDumpArgs(),
			"CLI : Failed to get arduino configuration information"
		).then((result) => {
			try {
				const config: ArduinoConfig = JSON.parse(result);
				if (Object.keys(config.config).length === 0) {
					// There is no arduino config file, let's create one
					this.runArduinoCommand(
						() => arduinoProject.getConfigInitArgs(),
						"CLI : Failed to create arduino config file",
						true, false
					).then((result) => {
						try {
							const config = JSON.parse(result);
							const configPath = path.dirname(config.config_path);
							const downloadPath = path.join(configPath, 'staging');
							this.runArduinoCommand(
								() => arduinoProject.getConfigSetDowloadDirectory(downloadPath),
								"CLI : Failed to set download directory setting",
								false, false
							).then(() => {
								this.runArduinoCommand(
									() => arduinoProject.getConfigSetDataDirectory(configPath),
									"CLI : Failed to set data directory setting",
									false, false
								).then(() => {
									const arduinoDir = path.join(this.getDocumentsFolderPath(), 'Arduino');
									this.runArduinoCommand(
										() => arduinoProject.getConfigSetUserDirectory(arduinoDir),
										"CLI : Failed to set user directory setting",
										false, false
									);
								});
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
	public checkArduinoCLICommand(): Promise<ArduinoCLIStatus> {
		return new Promise((resolve) => {
			const arduinoVersionArgs = arduinoProject.getVersionArguments();

			this.executeArduinoCommand(`${this.arduinoCLIPath}`, arduinoVersionArgs, true, false)
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
	public async getBoardConfiguration(): Promise<string> {
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
			const result = await this.executeArduinoCommand(`${arduinoCLI.arduinoCLIPath}`, configBoardArgs, true, false);

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
	public async runArduinoCommand(
		getArguments: () => string[],
		errorMessagePrefix: string,
		returnOutput: boolean = true,
		showOutput: boolean = false,
		channel: OutputChannel = arduinoCLIChannel,
		successMSG: string = ""
	): Promise<string> {
		try {
			const args = getArguments();
			const result = await this.executeArduinoCommand(`${this.arduinoCLIPath}`, args, returnOutput, showOutput, channel, successMSG);
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
	private getDocumentsFolderPath() {
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
	private getArduinoCliPath() {
		const platform = os.platform();
		this.arduinoCLIPath = '';

		switch (platform) {
			case 'win32':
				this.arduinoCLIPath = path.join(this.context.extensionPath, 'arduino_cli', 'win32', 'arduino-cli.exe');
				break;
			case 'darwin':
				this.arduinoCLIPath = path.join(this.context.extensionPath, 'arduino_cli', 'darwin', 'arduino-cli');
				break;
			case 'linux':
				this.arduinoCLIPath = path.join(this.context.extensionPath, 'arduino_cli', 'linux', 'arduino-cli');
				break;
			default:
				throw new Error(`Unsupported platform: ${platform}`);
		}
	}

	public async createNewSketch(name: string): Promise<string> {
		try {
			// Get the current workspace folder (assumes that there's an active workspace)
			if (!workspace.workspaceFolders) {
				throw new Error('No workspace folder is open. Please open a folder first.');
			}

			const currentDirectory = workspace.workspaceFolders[0].uri.fsPath;
			const fullName = path.join(currentDirectory, name);

			// Use the full name (current directory + sketch name)
			const args = arduinoProject.getNewSketchArguments(fullName);
			const result = await this.executeArduinoCommand(`${arduinoCLI.arduinoCLIPath}`, args, true, false);

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

	private executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = arduinoCLIChannel, successMsg: string = ""): Promise<string | void> {
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
}