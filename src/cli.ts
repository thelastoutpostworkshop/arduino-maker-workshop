import { commands, OutputChannel, Uri, window, workspace, ExtensionContext, ProgressLocation } from "vscode";
import { arduinoCLI, arduinoExtensionChannel, arduinoProject, compileStatusBarExecuting, compileStatusBarItem, compileStatusBarNotExecuting, loadArduinoConfiguration, updateStateCompileUpload, uploadStatusBarExecuting, uploadStatusBarItem, uploadStatusBarNotExecuting } from "./extension";
import { ArduinoCLIStatus, BuildOptions, CompileResult } from "./shared/messages";
import { getSerialMonitorApi, SerialMonitorApi, Version } from "@microsoft/vscode-serial-monitor-api";
import { COMPILE_RESULT_FILE, VSCODE_FOLDER } from "./ArduinoProject";
import { CLIArguments } from "./cliArgs";
import { ArduinoConfiguration } from "./config";
import { CliCache } from "./cliCache";

const CPP_PROPERTIES: string = "c_cpp_properties.json";

const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

enum CacheState {
	USE_CACHE,
	NO_CACHE
}

interface CacheSettings {
	caching: CacheState,
	ttl: number
}

export class ArduinoCLI {
	public arduinoCLIPath: string = "";
	public compileOrUploadRunning: boolean = false;
	private serialMonitorAPI: SerialMonitorApi | undefined = undefined;
	private arduinoCLIChannel: OutputChannel;
	private compileUploadChannel: OutputChannel;
	private cliArgs = new CLIArguments();
	private _lastCLIError: string = "";
	private cliStatus: ArduinoCLIStatus = { VersionString: "", Date: "" };
	private arduinoConfig = new ArduinoConfiguration();
	private activeProcess: any | null = null;
	private cliCache: CliCache;

	constructor(private context: ExtensionContext) {
		this.arduinoCLIChannel = window.createOutputChannel('Arduino CLI');
		this.compileUploadChannel = window.createOutputChannel('Arduino Compile & Upload');
		const cacheDirectory = path.join(context.globalStorageUri.fsPath, 'arduino-cli-cache');
		this.cliCache = new CliCache(cacheDirectory);
		arduinoExtensionChannel.appendLine(`arduino-cli cache created: ${cacheDirectory}`)

		getSerialMonitorApi(Version.latest, context).then((api) => {
			this.serialMonitorAPI = api;
		});
	}

	public lastCLIError(): string {
		return this._lastCLIError;
	}

	public getCLIStatus(): ArduinoCLIStatus {
		return this.cliStatus;
	}

	// Determine if the arduino-cli is ready to be used
	public async isCLIReady(): Promise<boolean> {
		await this.getArduinoCliPath();

		if (this.arduinoCLIPath === '') {
			return false;
		}
		try {
			this.cliStatus = await this.checkArduinoCLICommand();
			return true;
		} catch (error) {
			this._lastCLIError = "Cannot get CLI version";
			return false;
		}
	}

	private async checkArduinoCLICommand(): Promise<ArduinoCLIStatus> {
		const result = await this.runArduinoCommand(
			() => this.cliArgs.getVersionArguments(),
			"CLI: Failed to get Arduino CLI version information", { caching: CacheState.NO_CACHE, ttl: 10 }
		);
		arduinoCLI.getCoreUpdate();
		return (JSON.parse(result));
	}

	// Verify the arduino config
	public async isConfigReady(): Promise<boolean> {
		const isVerified = await this.arduinoConfig.verify();
		if (!isVerified) {
			this._lastCLIError = "Problem with the Arduino Config file";
			return false;
		}
		return true;
	}

	// #region arduino-cli config related commands
	//
	// Get the current configuration
	public async getArduinoConfig(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigDumpArgs(),
			"CLI: Failed to get arduino configuration information", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}

	// Remove additionnal board URL
	public async removeCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigRemoveAdditionalBoardURLArgs(URL),
			"CLI: Failed to delete additional Board URL", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}

	// Add additionnal board URL
	public async addCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigAddAdditionalBoardURLArgs(URL),
			"CLI: Failed to add additional Board URL", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}

	// Change additionnal board URL
	public async setCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetAdditionalBoardURLArgs(URL),
			"CLI: Failed to set additional Board URL", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}

	public async initArduinoConfiguration(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigInitArgs(),
			"CLI: Failed to create arduino config file", { caching: CacheState.NO_CACHE, ttl: 0 },
			true, false
		);
	}
	public async setConfigDownloadDirectory(downloadPath: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetDowloadDirectory(downloadPath),
			"CLI: Failed to set download directory setting", { caching: CacheState.NO_CACHE, ttl: 0 },
			false, false
		);
	}
	public async setConfigDataDirectory(configPath: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetDataDirectory(configPath),
			"CLI: Failed to set data directory setting", { caching: CacheState.NO_CACHE, ttl: 0 },
			false, false
		);
	}
	public async setConfigUserDirectory(arduinoDir: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetUserDirectory(arduinoDir),
			"CLI: Failed to set user directory setting", { caching: CacheState.NO_CACHE, ttl: 0 },
			false, false
		);
	}
	public async setConfigLibrary(enable: boolean): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetLibrarySetting(enable),
			"CLI: Failed to set library setting", { caching: CacheState.NO_CACHE, ttl: 0 },
			false, false
		);
	}
	// #endregion

	// #region arduino-cli outdated related commands
	//
	public async getOutdatedBoardAndLib(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getOutdatedArguments(),
			"CLI: Failed to get outdated Board and Libraries information", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}
	// #endregion

	// #region arduino-cli library related commands
	//
	public async runInstallLibraryVersion(library: string): Promise<string> {
		// Invalidate cache for libraries commands 
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getLibraryInstalledArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getLibrarySearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getInstallLibraryVersionArguments(library),
			"CLI: Failed to install library", { caching: CacheState.NO_CACHE, ttl: 0 }, true, true
		);
	}

	public async runUninstallLibrary(version: string): Promise<string> {
		// Invalidate cache for libraries commands 
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getLibraryInstalledArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getLibrarySearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getUninstallLibraryArguments(version),
			"CLI: Failed to remove library", { caching: CacheState.NO_CACHE, ttl: 0 }, true, true
		);
	}

	public async searchLibraryInstalled(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getLibraryInstalledArguments(),
			"CLI: Failed to get library installed", { caching: CacheState.USE_CACHE, ttl: 10 }
		);
	}

	public async searchLibrary(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getLibrarySearchArguments(),
			"CLI: Failed to get library available", { caching: CacheState.USE_CACHE, ttl: 10 }
		);
	}
	// #endregion

	// #region arduino-cli boards/Core related commands
	//
	public async runUninstallCoreVersion(version: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getUninstallCoreArguments(version),
			"CLI: Failed to remove board", { caching: CacheState.NO_CACHE, ttl: 0 }, true, true
		);
	}

	public async runInstallCoreVersion(board_id: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getInstallCoreVersionArguments(board_id),
			"CLI: Failed to install board", { caching: CacheState.NO_CACHE, ttl: 0 }, true, true
		);
	}

	public async searchCore(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getCoreSearchArguments(),
			"CLI: Failed to get boards available", { caching: CacheState.USE_CACHE, ttl: 10 }
		);
	}

	public async getCoreUpdate(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getCoreUpdateArguments(),
			"CLI: Failed to get board update information", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}
	public async getBoardsListAll(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getBoardsListArguments(),
			"CLI: Failed to get boards list ", { caching: CacheState.USE_CACHE, ttl: 10 }
		);
	}

	public async getBoardConnected(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getBoardConnectedArguments(),
			"CLI: Failed to get Boards ", { caching: CacheState.NO_CACHE, ttl: 0 }
		);
	}
	// #endregion

	public async compile(clean: boolean = false) {
		if (this.compileOrUploadRunning) {
			this.compileUploadChannel.show();
			return;
		}
		this.compileOrUploadRunning = true;
		this.compileUploadChannel.appendLine("Compile project starting...");

		await workspace.saveAll();

		try {
			const compileTitle = clean ? "Compiling project clean..." : "Compiling project...";
			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: compileTitle,
					cancellable: true,
				},
				async (progress, token) => {
					// Update the status bar
					compileStatusBarItem.text = compileStatusBarExecuting;

					// If the token signals cancellation
					token.onCancellationRequested(() => {
						this.cancelExecution(); // Ensure the compilation process stops
						this.compileUploadChannel.appendLine("Compilation cancelled by user.");
						compileStatusBarItem.text = compileStatusBarNotExecuting;
						this.setBuildResult(false);
						throw new Error("Compilation cancelled by user."); // Stop further execution
					});

					const output = await arduinoCLI.runArduinoCommand(
						() => this.cliArgs.getCompileCommandArguments(false, clean, arduinoProject.isConfigurationRequired()),
						"CLI: Failed to compile project", { caching: CacheState.NO_CACHE, ttl: 0 }, true, true, this.compileUploadChannel, "Compilation success!"
					);
					// Compilation success
					this.compileUploadChannel.appendLine("Compilation completed successfully.");
					this.createIntellisenseFile(output);
					this.setBuildResult(true);
				}
			);
		} catch (error) {
			this.compileUploadChannel.appendLine(`Compilation failed`);
			this.setBuildResult(false);
		} finally {
			compileStatusBarItem.text = compileStatusBarNotExecuting;
			this.compileOrUploadRunning = false;
			updateStateCompileUpload();
		}
	}

	public async upload() {
		if (this.compileOrUploadRunning) {
			this.compileUploadChannel.show();
			return;
		}
		this.compileUploadChannel.appendLine("Upload starting...");
		this.compileOrUploadRunning = true;

		if (this.serialMonitorAPI) {
			const port = arduinoProject.getPort();
			this.serialMonitorAPI.stopMonitoringPort(port);
		}
		try {
			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: `Uploading to ${arduinoProject.getBoard()} on ${arduinoProject.getPort()}`,
					cancellable: true,
				},
				async (progress, token) => {
					uploadStatusBarItem.text = uploadStatusBarExecuting;
					// If the token signals cancellation
					token.onCancellationRequested(() => {
						this.cancelExecution(); // Ensure the compilation process stops
						this.compileUploadChannel.appendLine("Upload cancelled by user.");
						uploadStatusBarItem.text = uploadStatusBarNotExecuting;
						// this.setBuildResult(false);
						throw new Error("Upload cancelled by user."); // Stop further execution
					});

					await arduinoCLI.runArduinoCommand(
						() => this.cliArgs.getUploadArguments(),
						"CLI: Failed to upload", { caching: CacheState.NO_CACHE, ttl: 0 }, false, true, this.compileUploadChannel
					);
					uploadStatusBarItem.text = uploadStatusBarNotExecuting;
					if (this.serialMonitorAPI) {
						let monitorPortSettings = arduinoProject.getMonitorPortSettings();
						arduinoExtensionChannel.appendLine(`Starting serial monitor with settings: ${JSON.stringify(monitorPortSettings)}`);
						this.serialMonitorAPI.startMonitoringPort(monitorPortSettings).then((port) => {
							arduinoExtensionChannel.appendLine(`Serial monitor started on port ${port}`);
						}).catch((err) => {
							arduinoExtensionChannel.appendLine(`Error starting serial monitor: ${err.message}`);
						});
					}
				}
			);
		} catch (error) {
			uploadStatusBarItem.text = uploadStatusBarNotExecuting;
			console.log(error);
		}
		this.compileOrUploadRunning = false;
	}
	public async installZipLibrary(buffer: ArrayBuffer) {
		try {
			const tempDir = os.tmpdir();
			const tempFileName = `library_${Date.now()}.zip`;
			const destinationPath = path.join(tempDir, tempFileName);

			fs.writeFileSync(destinationPath, Buffer.from(buffer));
			await arduinoCLI.setConfigLibrary(true);
			this.runArduinoCommand(
				() => this.cliArgs.getInstallZipLibrary(destinationPath),
				"CLI: Failed to get arduino configuration information", { caching: CacheState.NO_CACHE, ttl: 0 }
			);
		} catch (error) {
			window.showErrorMessage(`Failed to install zip library: ${error}`);
		}
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
			const configBoardArgs = this.cliArgs.getBoardConfigurationArguments();

			const result = await this.runArduinoCommand(
				() => configBoardArgs,
				"CLI: Failed to get board configuration", { caching: CacheState.NO_CACHE, ttl: 0 }, true, false
			);

			if (!result) {
				throw new Error("Command result empty");
			}
			return result;

		} catch (error: any) {
			window.showErrorMessage(`CLI: Error from get board configuration, you may have to installed the board using the board manager`);
			throw error;
		}
	}
	private async runArduinoCommand(
		getArguments: () => string[],
		errorMessagePrefix: string,
		cache: CacheSettings,
		returnOutput: boolean = true,
		showOutput: boolean = false,
		channel: OutputChannel = this.arduinoCLIChannel,
		successMSG: string = ""
	): Promise<string> {
		try {
			const args = getArguments();
			if (cache.caching == CacheState.USE_CACHE) {
				const cacheKey = this.cliCache.getCacheKeyFromArguments(args);
				const cachedData = this.cliCache.get(cacheKey);
				if (cachedData) {
					this.arduinoCLIChannel.appendLine(`Cache hit:${cacheKey}`);
					return cachedData;
				} else {
					this.arduinoCLIChannel.appendLine(`Cache miss, running command...`);

					const result = await this.executeArduinoCommand(`${this.arduinoCLIPath}`, args, returnOutput, showOutput, channel, successMSG);
					if (!result && returnOutput) {
						const errorMsg = `${errorMessagePrefix}: No result`;
						window.showErrorMessage(errorMsg);
						throw new Error("Command result empty");
					}
					this.cliCache.set(cacheKey, result, cache.ttl);
					return result || '';
				}
			} else {
				this.arduinoCLIChannel.appendLine(`No caching, running command...`);

				const result = await this.executeArduinoCommand(`${this.arduinoCLIPath}`, args, returnOutput, showOutput, channel, successMSG);
				if (!result && returnOutput) {
					const errorMsg = `${errorMessagePrefix}: No result`;
					window.showErrorMessage(errorMsg);
					throw new Error("Command result empty");
				}
				return result || '';
			}

		} catch (error: any) {
			window.showErrorMessage(`${errorMessagePrefix}`);
			throw error;
		}
	}

	private async getArduinoCliPath() {
		this.arduinoCLIPath = await this.getSystemArduinoCliPath();
		if (!this.arduinoCLIPath) {
			this.arduinoCLIPath = await this.getBundledArduinoCliPath();
		}
	}

	private async getSystemArduinoCliPath() {
		const platform = os.platform();
		const extConfig = workspace.getConfiguration('arduinoMakerWorkshop.arduinoCLI');
		const arduinoCLIInstallPath = extConfig.get('installPath');
		let arduinoCLIExecutable = extConfig.get('executable');

		if (!arduinoCLIExecutable) {
			if (platform === 'win32') {
				arduinoCLIExecutable = 'arduino-cli.exe';
			} else {
				arduinoCLIExecutable = 'arduino-cli';
			}
		}

		if (platform === 'darwin') {
			try {
				let arduinoCLIPath = path.join(arduinoCLIInstallPath, arduinoCLIExecutable);
				await workspace.fs.stat(arduinoCLIPath);
				this.arduinoCLIChannel.appendLine(`Using arduino CLI in ${arduinoCLIPath}`);
				return arduinoCLIPath;
			} catch {
				try {
					const which = require('which');
					let detectedArduinoCLI = await which(arduinoCLIExecutable);
					this.arduinoCLIChannel.appendLine(`Found system installed arduino CLI in ${detectedArduinoCLI}`);
					return detectedArduinoCLI;
				} catch { }
				return '';
			}
		}
		if (platform === 'win32') {
			try {
				let arduinoCLIPath = path.join(arduinoCLIInstallPath, arduinoCLIExecutable);
				const arduinoCLIUri = Uri.file(arduinoCLIPath);
				await workspace.fs.stat(arduinoCLIUri);
				this.arduinoCLIChannel.appendLine(`Using arduino CLI in ${arduinoCLIPath}`);
				return arduinoCLIPath;
			} catch {
				return '';
			}
		}
	}

	private async getBundledArduinoCliPath() {
		const platform = os.platform();
		const arch = os.arch();

		switch (platform) {
			case 'win32':
				return path.join(this.context.extensionPath, 'arduino_cli', 'win32', 'arduino-cli.exe');
			case 'darwin':
			case 'linux':
				const unixCLIPath = path.join(this.context.extensionPath, 'arduino_cli', platform, arch, 'arduino-cli');
				try {
					await fs.chmodSync(unixCLIPath, 0o755); // Set execute permission
					console.log(`Execute permission set for ${unixCLIPath}`);
				} catch (err) {
					console.error(`Failed to set execute permission for ${unixCLIPath}:`, err);
					throw err;
				}
				return unixCLIPath
			default:
				this._lastCLIError = `Unsupported platform: ${platform}`;
				break;
		}
		return '';
	}

	public async createNewSketch(name: string): Promise<string> {
		try {
			// Get the current workspace folder (assumes that there's an active workspace)
			if (!workspace.workspaceFolders) {
				throw new Error('No workspace folder is open. Please open a folder first.');
			}

			const currentDirectory = workspace.workspaceFolders[0].uri.fsPath;
			const sanitizedName = name.replace(/\s+/g, "_"); // Replace spaces with underscores
			const fullName = path.join(currentDirectory, sanitizedName);

			// Use the full name (current directory + sketch name)
			const args = this.cliArgs.getNewSketchArguments(fullName);
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
			window.showErrorMessage(`CLI: Failed to create new sketch - Sketch '${name}' may already exist`);
			throw error;
		}
	}

	private executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = this.arduinoCLIChannel, successMsg: string = ""): Promise<string | void> {
		if (showOutput) {
			channel.show(true);
		}
		this.arduinoCLIChannel.appendLine('Running Arduino CLI...');
		this.arduinoCLIChannel.appendLine(`${command}`);
		this.arduinoCLIChannel.appendLine(args.join(' '));

		const child = cp.spawn(`${command}`, args);
		this.activeProcess = child;
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
				const error = data.toString();
				if (showOutput) {
					channel.append(error);
				}
				if (returnOutput) {
					outputBuffer += error;
				}
			});

			child.on('close', (code: number) => {
				this.activeProcess = null;
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
				this.activeProcess = null;
				channel.appendLine(`Failed to run command: ${err.message}`);
				reject(undefined);
			});
			this.arduinoCLIChannel.appendLine('');
		});
	}

	private cancelExecution() {
		if (this.activeProcess) {
			this.activeProcess.kill();
			this.activeProcess = null;
			this.arduinoCLIChannel.appendLine('Command execution was canceled.');
		} else {
			window.showWarningMessage('No active command to cancel.');
		}
	}

	public setBuildResult(result: boolean) {
		const compileResult: CompileResult = { result: result };
		const buildPath = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput());
		if (fs.existsSync(buildPath)) {
			const resultFile = path.join(buildPath, COMPILE_RESULT_FILE);
			fs.writeFileSync(resultFile, JSON.stringify(compileResult, null, 2), 'utf-8');
		}
	}

	private createIntellisenseFile(output: string) {
		const includePathsForIntelissense = new Set<string>();
		const includePathsForArduinoSearch = new Set<string>();
		let compilerPath = '';
		let compileCommandJson: string = "";
		let compilerArgs: string[] = [];

		try {
			// Read includes.cache file and dynamically add paths
			const includeDataPath = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "includes.cache");
			const includeData = JSON.parse(fs.readFileSync(includeDataPath, 'utf8'));
			includeData.forEach((entry: any) => {
				if (!entry.Sourcefile) {
					if (entry.Includepath) {
						includePathsForIntelissense.add(`${entry.Includepath}/**`);
						includePathsForArduinoSearch.add(entry.Includepath);
					}
				} else {
					if (entry.Include) {
						if (entry.Includepath) {
							includePathsForIntelissense.add(`${entry.Includepath}/**`);
							includePathsForArduinoSearch.add(entry.Includepath);
						}
					}
				}
			});
		} catch (error) {
			arduinoExtensionChannel.appendLine('IntelliSense: includes.cache not found');
		}

		try {
			// Read build.options.json file and dynamically add paths
			const includeDataPath = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "build.options.json");
			const includeData: BuildOptions = JSON.parse(fs.readFileSync(includeDataPath, 'utf8'));
			if (includeData.otherLibrariesFolders) {
				includePathsForIntelissense.add(`${includeData.otherLibrariesFolders}/**`);
			}
			if (includeData.sketchLocation) {
				includePathsForIntelissense.add(`${includeData.sketchLocation}/**`);
			}
		} catch (error) {
			arduinoExtensionChannel.appendLine('IntelliSense: build.options.json not found');
		}


		try {
			// Read compile_commands.json file to extract the compilerPath
			compileCommandJson = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "compile_commands.json");
			const compileInfo = JSON.parse(fs.readFileSync(compileCommandJson, 'utf8'));
			for (const entry of compileInfo) {
				if (entry.arguments && Array.isArray(entry.arguments) && entry.arguments.length > 0) {
					compilerArgs = entry.arguments;
					compilerArgs.forEach((arg) => {
						const potentialPath = arg.trim(); // Remove any leading/trailing whitespace

						// Check if the argument is a valid path and is a directory
						if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isDirectory()) {
							includePathsForIntelissense.add(`${path.resolve(potentialPath)}/**`);
						}
					});
					compilerPath = entry.arguments[0]; // Take the first argument
					break; // Stop after finding the first valid entry
				}
			}
		} catch (error) {
			arduinoExtensionChannel.appendLine('IntelliSense: compile_commands.json not found');
		}

		// Search for defines in the compiled output
		const defines = new Set<string>(); // Use a Set to ensure uniqueness
		let match;
		const defineRegex = /-D([^\s]+)/g;
		while ((match = defineRegex.exec(output)) !== null) {
			defines.add(match[1]);
		}
		defines.add("USBCON");

		const arduinoHeaderPath = this.findArduinoHeaderRecursively(Array.from(includePathsForArduinoSearch));

		// Create c_cpp_properties.json 
		const cppProperties = {
			configurations: [{
				name: "Arduino",
				includePath: Array.from(includePathsForIntelissense),
				forcedInclude: arduinoHeaderPath ? [arduinoHeaderPath] : [], // Add arduinoHeaderPath if it exists
				compilerPath: compilerPath,
				compilerArgs: compilerArgs,
				defines: Array.from(defines),
				cStandard: "c17",
				cppStandard: "c++17"
			}],
			version: 4
		};
		// Write to c_cpp_properties.json
		const cppPropertiesPath = path.join(arduinoProject.getProjectPath(), VSCODE_FOLDER, CPP_PROPERTIES);
		fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));
	}

	private findFileRecursively(dir: string, fileName: string): string | null {
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					// Recursively search in subdirectories
					const result = this.findFileRecursively(fullPath, fileName);
					if (result) return result;
				} else if (entry.isFile() && entry.name === fileName) {
					return fullPath;
				}
			}
		} catch (error) {
			// Handle errors (e.g., permission denied) gracefully
			console.error(`Error accessing directory: ${dir}`, error);
		}
		return null; // Return null if the file is not found
	}

	private findArduinoHeaderRecursively(includePaths: string[]): string | null {
		for (const dir of includePaths) {
			const result = this.findFileRecursively(dir, 'Arduino.h');
			if (result) return result;
		}
		return null; // Return null if the file is not found in any directory
	}
}