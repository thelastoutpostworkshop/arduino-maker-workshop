import { commands, OutputChannel, Uri, window, workspace, ExtensionContext, ProgressLocation } from "vscode";
import { arduinoCLI, arduinoExtensionChannel, arduinoProject, arduinoYaml, compileOutputView, compileStatusBarExecuting, compileStatusBarItem, compileStatusBarNotExecuting, loadArduinoConfiguration, updateStateCompileUpload, uploadStatusBarExecuting, uploadStatusBarItem, uploadStatusBarNotExecuting } from "./extension";
import { ArduinoCLIStatus, BuildOptions, CompileResult, PROFILES_STATUS } from "./shared/messages";
import { getSerialMonitorApi, MonitorPortSettings, SerialMonitorApi, Version } from "@microsoft/vscode-serial-monitor-api";
import { COMPILE_RESULT_FILE, VSCODE_FOLDER } from "./ArduinoProject";
import { CLIArguments } from "./cliArgs";
import { ArduinoConfiguration } from "./config";
import { CliCache } from "./cliCache";
import type { CliOutputView } from "./cliOutputView";

const CPP_PROPERTIES: string = "c_cpp_properties.json";

const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BOARD_CACHE_TTL = 60 // 1 hour
const LIBRARY_INDEX_TTL = 30 // 30 minutes

enum CacheState {
	YES,
	NO
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
	private cliArgs = new CLIArguments();
	private _lastCLIError: string = "";
	private cliStatus: ArduinoCLIStatus = { VersionString: "", Date: "" };
	private arduinoConfig = new ArduinoConfiguration();
	private activeProcess: any | null = null;
	private cliCache: CliCache;

	constructor(private context: ExtensionContext) {
		this.arduinoCLIChannel = window.createOutputChannel('Arduino CLI');
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

	public getBuildPath(): string {
		return this.cliArgs.getBuildPath();
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
			"CLI: Failed to get Arduino CLI version information", { caching: CacheState.NO, ttl: 0 }
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
			"CLI: Failed to get arduino configuration information", { caching: CacheState.NO, ttl: 0 }
		);
	}

	// Remove additionnal board URL
	public async removeCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		// Invalidate caches 
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigRemoveAdditionalBoardURLArgs(URL),
			"CLI: Failed to delete additional Board URL", { caching: CacheState.NO, ttl: 0 }, false, false
		);
	}

	// Add additionnal board URL
	public async addCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		// Invalidate caches
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigAddAdditionalBoardURLArgs(URL),
			"CLI: Failed to add additional Board URL", { caching: CacheState.NO, ttl: 0 }, false, false
		);
	}

	// Change additionnal board URL
	public async setCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		// Invalidate caches
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetAdditionalBoardURLArgs(URL),
			"CLI: Failed to set additional Board URL", { caching: CacheState.NO, ttl: 0 }, false, false
		);
	}

	// Create and initialize a new arduino configuration file
	public async initArduinoConfiguration(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigInitArgs(),
			"CLI: Failed to create arduino config file", { caching: CacheState.NO, ttl: 0 },
			true, false
		);
	}

	// Set directory used to stage downloaded archives during Boards/Library Manager installations.
	public async setConfigDownloadDirectory(downloadPath: string): Promise<string> {
		// Invalidate cache
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetDowloadDirectory(downloadPath),
			"CLI: Failed to set download directory setting", { caching: CacheState.NO, ttl: 0 },
			false, false
		);
	}

	// Set directory used to store Boards/Library Manager index files and Boards Manager platform installations.
	public async setConfigDataDirectory(configPath: string): Promise<string> {
		// Invalidate cache
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetDataDirectory(configPath),
			"CLI: Failed to set data directory setting", { caching: CacheState.NO, ttl: 0 },
			false, false
		);
	}

	// Set the equivalent of the Arduino IDE's "sketchbook" directory. Library Manager installations are made to the libraries subdirectory of the user director
	public async setConfigUserDirectory(arduinoDir: string): Promise<string> {
		// Invalidate cache
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetUserDirectory(arduinoDir),
			"CLI: Failed to set user directory setting", { caching: CacheState.NO, ttl: 0 },
			false, false
		);
	}

	// Set the equivalent of the Arduino IDE's "sketchbook" directory. Library Manager installations are made to the libraries subdirectory of the user director
	public async getConfigUserDirectory(): Promise<string> {

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigGetUserDirectory(),
			"CLI: Failed to get user directory setting", { caching: CacheState.NO, ttl: 0 },
			true, false
		);
	}

	// Enable the use of the --git-url and --zip-file flags with arduino-cli lib install
	public async setConfigLibrary(enable: boolean): Promise<string> {
		// Invalidate cache
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getConfigDumpArgs()));

		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetLibrarySetting(enable),
			"CLI: Failed to set library setting", { caching: CacheState.NO, ttl: 0 },
			false, false
		);
	}
	// #endregion

	// #region arduino-cli outdated related commands
	//
	// Get cores and libraries that can be upgraded
	public async getOutdatedBoardAndLib(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getOutdatedArguments(),
			"CLI: Failed to get outdated Board and Libraries information", { caching: CacheState.NO, ttl: 0 }
		);
	}
	// #endregion

	// #region arduino-cli library related commands
	//

	// Install a library version
	public async runInstallLibraryVersion(library: string): Promise<string> {
		// Invalidate cache for libraries commands 
		this.clearLibraryCache();

		return this.runArduinoCommand(
			() => this.cliArgs.getInstallLibraryVersionArguments(library),
			"CLI: Failed to install library", { caching: CacheState.NO, ttl: 0 }, true, true
		);
	}

	// Uninstall a library version
	public async runUninstallLibrary(version: string): Promise<string> {
		// Invalidate cache for libraries commands 
		this.clearLibraryCache();

		return this.runArduinoCommand(
			() => this.cliArgs.getUninstallLibraryArguments(version),
			"CLI: Failed to remove library", { caching: CacheState.NO, ttl: 0 }, true, true
		);
	}

	// Invalidate cache for libraries 
	public clearLibraryCache() {
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getLibraryInstalledArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getLibrarySearchArguments()));
	}

	// Get the list of libraries installed
	public async searchLibraryInstalled(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getLibraryInstalledArguments(),
			"CLI: Failed to get library installed", { caching: CacheState.YES, ttl: LIBRARY_INDEX_TTL }
		);
	}

	// Get board-related examples from platform libraries
	public async searchBoardExamples(): Promise<string> {
		if (!loadArduinoConfiguration()) {
			window.showErrorMessage(`Unable to load Project Configuration`);
			throw new Error("Unable to load Project Configuration");
		}
		if (!arduinoProject.getBoard()) {
			window.showErrorMessage(`Select a board first`);
			throw new Error("Board not selected");
		}
		const result = await this.runArduinoCommand(
			() => this.cliArgs.getBoardExamplesArguments(),
			"CLI: Failed to get board examples", { caching: CacheState.NO, ttl: LIBRARY_INDEX_TTL }
		);
		return this.filterBoardExamples(result);
	}

	// Get all the libraries avalaible in the Arduino registry
	public async searchLibrary(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getLibrarySearchArguments(),
			"CLI: Failed to get library available", { caching: CacheState.YES, ttl: LIBRARY_INDEX_TTL }
		);
	}
	// #endregion

	// #region arduino-cli boards/Core related commands
	//

	// Installs cores and corresponding tool dependencies.
	public async runInstallCoreVersion(board_id: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getInstallCoreVersionArguments(board_id),
			"CLI: Failed to install board", { caching: CacheState.NO, ttl: 0 }, true, true
		);
	}

	// Uninstalls cores and corresponding tool dependencies if no longer used.
	public async runUninstallCoreVersion(version: string): Promise<string> {
		// Invalidate cache core & boards
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getBoardsListArguments()));
		this.cliCache.delete(this.cliCache.getCacheKeyFromArguments(this.cliArgs.getCoreSearchArguments()));

		return this.runArduinoCommand(
			() => this.cliArgs.getUninstallCoreArguments(version),
			"CLI: Failed to remove board", { caching: CacheState.NO, ttl: 0 }, true, true
		);
	}

	// Get all the cores avalaible in the Arduino registry
	public async searchCore(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getCoreSearchArguments(),
			"CLI: Failed to get boards available", { caching: CacheState.YES, ttl: BOARD_CACHE_TTL }
		);
	}

	// Updates the index of cores to the latest version.
	public async getCoreUpdate(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getCoreUpdateArguments(),
			"CLI: Failed to get board update information", { caching: CacheState.YES, ttl: BOARD_CACHE_TTL }
		);
	}

	// Get all boards in the Boards Manager
	public async getBoardsListAll(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getBoardsListArguments(),
			"CLI: Failed to get boards list ", { caching: CacheState.YES, ttl: BOARD_CACHE_TTL }
		);
	}

	// Detects and displays a list of boards connected to the current computer
	public async getBoardConnected(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getBoardConnectedArguments(),
			"CLI: Failed to get Boards ", { caching: CacheState.NO, ttl: 0 }
		);
	}
	// #endregion

	public async compile(clean: boolean = false, createBuildProfile = false): Promise<string> {
		if (this.compileOrUploadRunning) {
			await compileOutputView?.prepare('Arduino CLI Output', false);
			return "";
		}
		this.compileOrUploadRunning = true;

		let useBuildProfile: boolean;
		let profileMsg = "";
		let successMsg = "";
		await workspace.saveAll();

		try {
			if (createBuildProfile) {
				useBuildProfile = true;
				profileMsg = ", creating a build profile";
				successMsg = "Build profile compilation success!"
			} else {
				useBuildProfile = arduinoYaml.status() == PROFILES_STATUS.ACTIVE;
				if (useBuildProfile) {
					profileMsg = `, using profile ${arduinoYaml.getProfileName()}`;
					successMsg = `Profile  ${arduinoYaml.getProfileName()} compilation success!`
				} else {
					profileMsg = "";
					successMsg = "Compilation success!"
				}
			}

			const verboseFlag = this.cliArgs.getVerboseOption();
			const optimizeDebugFlag = arduinoProject.optimizeForDebug();
			const compileMode = (optimizeDebugFlag ? "for debug, " : "for release, ") + (verboseFlag ? "verbose" : "silent") + profileMsg;

			let compileTitle: string = clean
				? `Compiling project clean (${compileMode})...`
				: `Compiling project (${compileMode})...`;

			if (createBuildProfile) {
				compileTitle = "Compiling project to create a build profile..."
			}

			await compileOutputView?.prepare(compileTitle);
			compileOutputView?.setStatus('info', 'Starting compilation...');
			compileOutputView?.appendInfo('Compile project starting...\n');

			const output = await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: compileTitle,
					cancellable: true,
				},
				async (progress, token) => {
					compileStatusBarItem.text = compileStatusBarExecuting;

					token.onCancellationRequested(() => {
						this.cancelExecution();
						compileStatusBarItem.text = compileStatusBarNotExecuting;
						this.setBuildResult(false);
						compileOutputView?.appendInfo("Compilation cancelled by user.\n");
						compileOutputView?.setStatus('canceled', 'Compilation cancelled by user.');
						throw new Error("Compilation cancelled by user.");
					});

					const output = await arduinoCLI.runArduinoCommand(
						() => this.cliArgs.getCompileCommandArguments(false, clean, arduinoProject.isConfigurationRequired(), createBuildProfile),
						"CLI: Failed to compile project",
						{ caching: CacheState.NO, ttl: 0 },
						true,
						compileOutputView ? false : true,
						this.arduinoCLIChannel,
						successMsg,
						compileOutputView
					);

					this.setBuildResult(true);
					compileOutputView?.setStatus('success', successMsg || 'Compilation completed successfully.');

					if (!createBuildProfile) {
						this.createIntellisenseFile(output);
						return "";
					}

					return output;
				}
			);

			return output || "";
		} catch (error) {
			this.setBuildResult(false);
			compileOutputView?.setStatus('failure', 'Compilation failed.');
		} finally {
			compileStatusBarItem.text = compileStatusBarNotExecuting;
			this.compileOrUploadRunning = false;
			updateStateCompileUpload();
		}

		return "";
	}


	public async upload() {
		if (this.compileOrUploadRunning) {
			await compileOutputView?.prepare('Arduino CLI Output', false);
			return;
		}
		const useBuildProfile = arduinoYaml.status() == PROFILES_STATUS.ACTIVE;
		this.compileOrUploadRunning = true;
		const uploadTitleBase = useBuildProfile
			? `Uploading from profile ${arduinoYaml.getProfileName()}`
			: `Uploading to ${arduinoProject.getBoard()} `;
		let uploadTitle = uploadTitleBase;
		let errorMsg: string;
		if (useBuildProfile) {
			errorMsg = `Uploading failed from profile ${arduinoYaml.getProfileName()}`;
		} else {
			errorMsg = "Failed to upload";
		}

		if (this.serialMonitorAPI) {
			let port
			if (useBuildProfile) {
				port = arduinoYaml.getProfilePort(arduinoYaml.getProfileName());
			} else {
				port = arduinoProject.getPort();
			}
			if (port) {
				this.serialMonitorAPI.stopMonitoringPort(port);
			}
		}
		try {
			if (!useBuildProfile && arduinoProject.useProgrammer()) {
				uploadTitle += ` using programmer ${arduinoProject.getProgrammer()}`;
			}
			if (!useBuildProfile) {
				uploadTitle += ` on ${arduinoProject.getPort()}`;
			}

			await compileOutputView?.prepare(uploadTitle.trim(), false);
			compileOutputView?.setStatus('info', 'Starting upload...');
			compileOutputView?.appendInfo('Upload starting...\n');

			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: uploadTitle.trim(),
					cancellable: true,
				},
				async (progress, token) => {
					uploadStatusBarItem.text = uploadStatusBarExecuting;
					// If the token signals cancellation
					token.onCancellationRequested(() => {
						this.cancelExecution(); // Ensure the compilation process stops
						uploadStatusBarItem.text = uploadStatusBarNotExecuting;
						// this.setBuildResult(false);
						throw new Error("Upload cancelled by user."); // Stop further execution
					});

					await arduinoCLI.runArduinoCommand(
						() => this.cliArgs.getUploadArguments(),
						errorMsg,
						{ caching: CacheState.NO, ttl: 0 },
						false,
						compileOutputView ? false : true,
						this.arduinoCLIChannel,
						"Upload completed successfully.",
						compileOutputView
					);
					uploadStatusBarItem.text = uploadStatusBarNotExecuting;
					if (this.serialMonitorAPI) {
						let monitorPortSettings: MonitorPortSettings;
						if (useBuildProfile) {
							const profileName = arduinoYaml.getProfileName(); // resolves default or selected
							const monitorPortSettings = arduinoYaml.getProfileMonitorPortSettings(profileName);
							if (monitorPortSettings) {
								arduinoExtensionChannel.appendLine(`Starting serial monitor with build profile '${profileName}': ${JSON.stringify(monitorPortSettings)}`);
								this.serialMonitorAPI.startMonitoringPort(monitorPortSettings).then((port) => {
									arduinoExtensionChannel.appendLine(`Serial monitor started on port ${port}`);
								}).catch((err) => {
									arduinoExtensionChannel.appendLine(`Error starting serial monitor: ${err.message}`);
								});
							}


						} else {
							monitorPortSettings = arduinoProject.getMonitorPortSettings();
							arduinoExtensionChannel.appendLine(`Starting serial monitor with settings: ${JSON.stringify(monitorPortSettings)}`);
							this.serialMonitorAPI.startMonitoringPort(monitorPortSettings).then((port) => {
								arduinoExtensionChannel.appendLine(`Serial monitor started on port ${port}`);
							}).catch((err) => {
								arduinoExtensionChannel.appendLine(`Error starting serial monitor: ${err.message}`);
							});
						}
					}
				}
			);
			compileOutputView?.setStatus('success', 'Upload completed successfully.');
			compileOutputView?.appendInfo('Upload completed successfully.\n');
		} catch (error) {
			uploadStatusBarItem.text = uploadStatusBarNotExecuting;
			console.log(error);
			if (error instanceof Error && error.message === "Upload cancelled by user.") {
				compileOutputView?.setStatus('canceled', error.message);
				compileOutputView?.appendInfo(`${error.message}\n`);
			} else {
				compileOutputView?.setStatus('failure', 'Upload failed.');
				compileOutputView?.appendInfo('Upload failed.\n');
			}
		}
		this.compileOrUploadRunning = false;
	}

	public async installZipLibrary(buffer: ArrayBuffer) {
		try {
			this.clearLibraryCache();
			const tempDir = os.tmpdir();
			const tempFileName = `library_${Date.now()}.zip`;
			const destinationPath = path.join(tempDir, tempFileName);

			fs.writeFileSync(destinationPath, Buffer.from(buffer));
			await arduinoCLI.setConfigLibrary(true);

			// Here we have to wait for the arduino-cli to complete, because the webview must wait before asking for installed libraries
			await this.runArduinoCommand(
				() => this.cliArgs.getInstallZipLibrary(destinationPath),
				"CLI: Failed to get arduino configuration information", { caching: CacheState.NO, ttl: 0 }
			);
			window.showInformationMessage("Library is now installed (zip)")
		} catch (error) {
			window.showErrorMessage(`Failed to install zip library: ${error}`);
		}
	}

	public async getBoardConfiguration(): Promise<string> {
		console.log("getBoardConfiguration");
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
				"CLI: Failed to get board configuration", { caching: CacheState.NO, ttl: 0 }, true, false
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
	public async getProfileBoardConfiguration(fqbn: string): Promise<string> {
		try {
			const configBoardArgs = this.cliArgs.getProfileBoardConfigurationArguments(fqbn);

			const result = await this.runArduinoCommand(
				() => configBoardArgs,
				"CLI: Failed to get board configuration", { caching: CacheState.NO, ttl: 0 }, true, false
			);

			if (!result) {
				throw new Error("Command result empty");
			}
			return result;

		} catch (error: any) {
			window.showErrorMessage(`CLI: Error from get board configuration from the profile`);
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
		successMSG: string = "",
		coloredOutputView?: CliOutputView
	): Promise<string> {
		try {
			const args = getArguments();
			if (args.length == 0) {
				window.showErrorMessage(errorMessagePrefix);
			}
			if (coloredOutputView) {
				const cliExecutable = this.arduinoCLIPath || 'arduino-cli';
				coloredOutputView.showCommand(cliExecutable, args);
				coloredOutputView.setStatus('info', 'Running Arduino CLI...');
			}
			if (cache.caching == CacheState.YES) {
				const cacheKey = this.cliCache.getCacheKeyFromArguments(args);
				this.arduinoCLIChannel.appendLine(`Cache key:${cacheKey}`)
				const cachedData = this.cliCache.get(cacheKey);
				if (cachedData) {
					this.arduinoCLIChannel.appendLine(`Cache hit:${cacheKey}`);
					coloredOutputView?.append(`Cache hit: ${cacheKey}\n`);
					return cachedData;
				} else {
					this.arduinoCLIChannel.appendLine(`Cache miss, running command...`);

					const result = await this.executeArduinoCommand(`${this.arduinoCLIPath}`, args, returnOutput, showOutput, channel, successMSG, coloredOutputView);
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

				const result = await this.executeArduinoCommand(`${this.arduinoCLIPath}`, args, returnOutput, showOutput, channel, successMSG, coloredOutputView);
				if (!result && returnOutput) {
					const errorMsg = `${errorMessagePrefix}: No result`;
					window.showErrorMessage(errorMsg);
					throw new Error("Command result empty");
				}
				return result || '';
			}

		} catch (error: any) {
			window.showErrorMessage(`${errorMessagePrefix}`);
			coloredOutputView?.setStatus('failure', `${errorMessagePrefix}`);
			throw error;
		}
	}

	private filterBoardExamples(rawOutput: string): string {
		if (!rawOutput) {
			return rawOutput;
		}
		try {
			const parsed = JSON.parse(rawOutput);
			if (!parsed?.installed_libraries || !Array.isArray(parsed.installed_libraries)) {
				return rawOutput;
			}
			const platformId = this.getBoardPlatformId();
			parsed.installed_libraries = parsed.installed_libraries.filter((entry: any) => {
				const lib = entry?.library;
				if (!lib || lib.location === "user") {
					return false;
				}
				if (!platformId) {
					return true;
				}
				if (!lib.container_platform || typeof lib.container_platform !== "string") {
					return true;
				}
				return lib.container_platform.startsWith(platformId);
			});
			return JSON.stringify(parsed);
		} catch (error) {
			return rawOutput;
		}
	}

	private getBoardPlatformId(): string {
		const fqbn = this.getBoardFqbnForExamples();
		if (!fqbn) {
			return "";
		}
		const parts = fqbn.split(':');
		if (parts.length < 2) {
			return "";
		}
		return `${parts[0]}:${parts[1]}`;
	}

	private getBoardFqbnForExamples(): string {
		if (arduinoYaml.status() == PROFILES_STATUS.ACTIVE) {
			const profileName = arduinoYaml.getProfileName();
			const profile = arduinoYaml.getProfile(profileName);
			if (profile?.fqbn) {
				return profile.fqbn;
			}
		}
		return arduinoProject.getBoard();
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

	private executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = this.arduinoCLIChannel, successMsg: string = "", coloredOutputView?: CliOutputView): Promise<string | void> {
		if (showOutput) {
			channel.show(true);
		}
		this.arduinoCLIChannel.appendLine('Running Arduino CLI...');
		this.arduinoCLIChannel.appendLine(`${command}`);
		this.arduinoCLIChannel.appendLine(args.join(' '));
		if (coloredOutputView) {
			coloredOutputView.append(`$ ${command} ${args.join(' ')}\n`);
		}

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
				coloredOutputView?.append(output);

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
				coloredOutputView?.append(error);
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
					coloredOutputView?.append('Command executed successfully.\n');
					if (successMsg) {
						coloredOutputView?.setStatus('success', successMsg);
					} else {
						coloredOutputView?.setStatus('success', 'Command executed successfully.');
					}
					if (successMsg) {
						window.showInformationMessage(successMsg);
					}
					resolve(returnOutput ? outputBuffer : undefined);
				} else {
					channel.appendLine(`Command failed with code ${code}.`);
					coloredOutputView?.append(`Command failed with code ${code}.\n`);
					coloredOutputView?.setStatus('failure', `Command failed with code ${code}.`);
					reject(undefined);
				}
			});

			child.on('error', (err: any) => {
				this.activeProcess = null;
				channel.appendLine(`Failed to run command: ${err.message}`);
				coloredOutputView?.append(`Failed to run command: ${err.message}\n`);
				coloredOutputView?.setStatus('failure', `Failed to run command: ${err.message}`);
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
			compileOutputView?.appendInfo('Command execution was canceled.\n');
			compileOutputView?.setStatus('canceled', 'Command execution was canceled.');
		} else {
			window.showWarningMessage('No active command to cancel.');
		}
	}

	public setBuildResult(result: boolean) {
		const compileResult: CompileResult = { result: result };
		const buildPath = this.getBuildPath();
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
			const includeDataPath = path.join(this.getBuildPath(), "includes.cache");
			const includeData = this.parseIncludesCache(fs.readFileSync(includeDataPath, 'utf8'));
			includeData.forEach((entry: any) => {
				if (!entry || typeof entry !== 'object') {
					return;
				}
				if (!entry.Sourcefile) {
					if (entry.Includepath) {
						this.addIncludePath(entry.Includepath, includePathsForIntelissense, includePathsForArduinoSearch);
					}
				} else {
					if (entry.Include) {
						if (entry.Includepath) {
							this.addIncludePath(entry.Includepath, includePathsForIntelissense, includePathsForArduinoSearch);
						}
					}
				}
			});
		} catch (error) {
			arduinoExtensionChannel.appendLine('IntelliSense: includes.cache not found');
		}

		try {
			// Read build.options.json file and dynamically add paths
			const includeDataPath = path.join(this.getBuildPath(), "build.options.json");
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
			compileCommandJson = path.join(this.getBuildPath(), "compile_commands.json");
			const compileInfo = JSON.parse(fs.readFileSync(compileCommandJson, 'utf8'));
			for (const entry of compileInfo) {
				const entryArgs = this.getCompilerArgsFromEntry(entry, includePathsForIntelissense, includePathsForArduinoSearch);
				if (entryArgs.length > 0) {
					compilerArgs = entryArgs;
					compilerPath = entryArgs[0]; // Take the first argument
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

	private parseIncludesCache(includeDataRaw: string): any[] {
		const trimmed = includeDataRaw.trim();
		if (!trimmed) {
			return [];
		}
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed;
			}
			if (parsed && typeof parsed === 'object') {
				if (Array.isArray((parsed as any).includes)) {
					return (parsed as any).includes;
				}
				if (Array.isArray((parsed as any).data)) {
					return (parsed as any).data;
				}
				return [parsed];
			}
		} catch (error) {
			// Fall back to JSONL parsing.
		}

		const entries: any[] = [];
		const lines = includeDataRaw.split(/\r?\n/);
		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine) {
				continue;
			}
			try {
				entries.push(JSON.parse(trimmedLine));
			} catch (error) {
				continue;
			}
		}
		return entries;
	}

	private cleanIncludePath(includePath: string): string {
		return includePath.trim().replace(/^["']|["']$/g, '');
	}

	private addIncludePath(includePath: string, includePathsForIntelissense: Set<string>, includePathsForArduinoSearch: Set<string>, baseDir?: string) {
		const cleanedPath = this.cleanIncludePath(includePath);
		if (!cleanedPath) {
			return;
		}
		const resolvedPath = baseDir ? path.resolve(baseDir, cleanedPath) : cleanedPath;
		includePathsForIntelissense.add(`${resolvedPath}/**`);
		if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
			includePathsForArduinoSearch.add(resolvedPath);
		}
	}

	private addIncludePathsFromCompilerArgs(args: string[], includePathsForIntelissense: Set<string>, includePathsForArduinoSearch: Set<string>, baseDir?: string) {
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (!arg) {
				continue;
			}
			if (arg === "-I" || arg === "-isystem") {
				const nextArg = args[i + 1];
				if (nextArg) {
					this.addIncludePath(nextArg, includePathsForIntelissense, includePathsForArduinoSearch, baseDir);
					i++;
				}
				continue;
			}
			if (arg.startsWith("-I") && arg.length > 2) {
				this.addIncludePath(arg.slice(2), includePathsForIntelissense, includePathsForArduinoSearch, baseDir);
				continue;
			}
			if (arg.startsWith("-isystem") && arg.length > 8) {
				this.addIncludePath(arg.slice(8), includePathsForIntelissense, includePathsForArduinoSearch, baseDir);
				continue;
			}
			const potentialPath = this.cleanIncludePath(arg);
			if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isDirectory()) {
				this.addIncludePath(potentialPath, includePathsForIntelissense, includePathsForArduinoSearch, baseDir);
			}
		}
	}

	private tokenizeCommand(command: string): string[] {
		const tokens: string[] = [];
		let current = '';
		let quote: string | null = null;

		for (let i = 0; i < command.length; i++) {
			const char = command[i];
			if (quote) {
				if (char === quote) {
					quote = null;
				} else {
					current += char;
				}
				continue;
			}
			if (char === '"' || char === "'") {
				quote = char;
				continue;
			}
			if (/\s/.test(char)) {
				if (current) {
					tokens.push(current);
					current = '';
				}
				continue;
			}
			current += char;
		}
		if (current) {
			tokens.push(current);
		}
		return tokens;
	}

	private getCompilerArgsFromEntry(entry: any, includePathsForIntelissense: Set<string>, includePathsForArduinoSearch: Set<string>): string[] {
		const args = Array.isArray(entry?.arguments) ? entry.arguments : this.tokenizeCommand(entry?.command || "");
		if (!args.length) {
			return [];
		}
		const baseDir = typeof entry?.directory === "string" && entry.directory ? entry.directory : undefined;
		this.addIncludePathsFromCompilerArgs(args, includePathsForIntelissense, includePathsForArduinoSearch, baseDir);
		return args;
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
