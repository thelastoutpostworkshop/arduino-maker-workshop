import { commands, OutputChannel, Uri, window, workspace, ExtensionContext } from "vscode";
import { arduinoCLI, arduinoProject, compileStatusBarExecuting, compileStatusBarItem, compileStatusBarNotExecuting, loadArduinoConfiguration, updateStateCompileUpload, uploadStatusBarExecuting, uploadStatusBarItem, uploadStatusBarNotExecuting } from "./extension";
import { ArduinoCLIStatus, BuildOptions, Compile, CompileResult } from "./shared/messages";
import { getSerialMonitorApi, LineEnding, Parity, SerialMonitorApi, StopBits, Version } from "@microsoft/vscode-serial-monitor-api";
import { COMPILE_RESULT_FILE, VSCODE_FOLDER } from "./ArduinoProject";
import { CLIArguments } from "./cliArgs";
import { ArduinoConfiguration } from "./config";

const CPP_PROPERTIES: string = "c_cpp_properties.json";

const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

export class ArduinoCLI {
	public arduinoCLIPath: string = "";
	public compileOrUploadRunning: boolean = false;
	private serialMoniorAPI: SerialMonitorApi | undefined = undefined;
	private arduinoCLIChannel: OutputChannel;
	private compileUploadChannel: OutputChannel;
	private cliArgs = new CLIArguments();
	private _lastCLIError: string = "";
	private cliStatus: ArduinoCLIStatus = { VersionString: "", Date: "" };
	private arduinoConfig = new ArduinoConfiguration();

	constructor(private context: ExtensionContext) {
		this.arduinoCLIChannel = window.createOutputChannel('Arduino CLI');
		this.compileUploadChannel = window.createOutputChannel('Arduino Compile & Upload');
		this.getArduinoCliPath();

		getSerialMonitorApi(Version.latest, context).then((api) => {
			this.serialMoniorAPI = api;
		});
	}

	public lastCLIError(): string {
		return this._lastCLIError;
	}

	public getCLIStatus(): ArduinoCLIStatus {
		return this.cliStatus;
	}
	public async isCLIReady(): Promise<boolean> {
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
	public async isConfigReady(): Promise<boolean> {
		const isVerified = await this.arduinoConfig.verify();
		if (!isVerified) {
			this._lastCLIError = "Problem with the Arduino Config file";
			return false;
		}
		return true;
	}

	public async getOutdatedBoardAndLib(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getOutdatedArguments(),
			"CLI : Failed to get outdated Board and Libraries information"
		);
	}
	public async searchLibraryInstalled(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getLibraryInstalledArguments(),
			"CLI: Failed to get library installed"
		);
	}
	public async getCLIConfig(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigDumpArgs(),
			"CLI : Failed to get CLI Config information"
		);
	}

	public async removeCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigRemoveAdditionalBoardURLArgs(URL),
			"CLI : Failed to delete additional Board URL", false
		);
	}

	public async addCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigAddAdditionalBoardURLArgs(URL),
			"CLI : Failed to add additional Board URL", false
		);
	}

	public async setCLIConfigAdditionalBoardURL(URL: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetAdditionalBoardURLArgs(URL),
			"CLI : Failed to set additional Board URL", false
		);
	}
	public async searchCore(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getCoreSearchArguments(),
			"CLI: Failed to get boards available"
		);
	}

	public async searchLibrary(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getLibrarySearchArguments(),
			"CLI: Failed to get library available"
		);
	}

	public async runInstallLibraryVersion(library: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getInstallLibraryVersionArguments(library),
			"CLI: Failed to install library", true, true
		);
	}

	public async runInstallCoreVersion(board_id: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getInstallCoreVersionArguments(board_id),
			"CLI: Failed to install board", true, true
		);
	}

	public async runUninstallLibrary(version: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getUninstallLibraryArguments(version),
			"CLI: Failed to remove library", true, true
		);
	}

	public async runUninstallCoreVersion(version: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getUninstallCoreArguments(version),
			"CLI: Failed to remove board", true, true
		);
	}

	public async getCoreUpdate(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getCoreUpdateArguments(),
			"CLI: Failed to get board update information"
		);
	}
	public async getBoardsListAll(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getBoardsListArguments(),
			"CLI: Failed to get boards list "
		);
	}

	public async getBoardConnected(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getBoardConnectedArguments(),
			"CLI: Failed to get Boards "
		);
	}
	public async getArduinoConfig(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigDumpArgs(),
			"CLI : Failed to get arduino configuration information"
		);
	}
	public async initArduinoConfiguration(): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigInitArgs(),
			"CLI : Failed to create arduino config file",
			true, false
		);
	}
	public async setConfigDownloadDirectory(downloadPath: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetDowloadDirectory(downloadPath),
			"CLI : Failed to set download directory setting",
			false, false
		);
	}
	public async setConfigDataDirectory(configPath: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetDataDirectory(configPath),
			"CLI : Failed to set data directory setting",
			false, false
		);
	}
	public async setConfigUserDirectory(arduinoDir: string): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetUserDirectory(arduinoDir),
			"CLI : Failed to set user directory setting",
			false, false
		);
	}
	public async setConfigLibrary(enable: boolean): Promise<string> {
		return this.runArduinoCommand(
			() => this.cliArgs.getConfigSetLibrarySetting(enable),
			"CLI : Failed to set library setting",
			false, false
		);
	}
	public async compile(clean: boolean = false) {
		if (this.compileOrUploadRunning) {
			this.compileUploadChannel.show();
			return;
		}
		this.compileOrUploadRunning = true;
		this.compileUploadChannel.appendLine("Compile project starting...");
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showErrorMessage('Board info not found, cannot compile');
		}
		if(arduinoProject.isConfigurationRequired()) {
			if (!arduinoProject.getBoardConfiguration()) {
				window.showErrorMessage('Board configuration not found, cannot compile');
			}
		}
		if (!arduinoProject.getOutput()) {
			window.showErrorMessage('Output not found, cannot compile');
		}

		try {
			compileStatusBarItem.text = compileStatusBarExecuting;
			await arduinoCLI.runArduinoCommand(
				() => this.cliArgs.getCompileCommandArguments(false, clean,arduinoProject.isConfigurationRequired()),
				"CLI: Failed to compile project", true, true, this.compileUploadChannel, "Compilation success!"
			);
			compileStatusBarItem.text = compileStatusBarNotExecuting;
			this.generateIntellisense();
			this.createCompileResult(true);
			updateStateCompileUpload();
		} catch (error) {
			this.createCompileResult(false);
			compileStatusBarItem.text = compileStatusBarNotExecuting;
			console.log(error);
		}
		this.compileOrUploadRunning = false;
	}
	public async upload() {
		if (this.compileOrUploadRunning) {
			this.compileUploadChannel.show();
			return;
		}
		this.compileUploadChannel.appendLine("Upload starting...");
		this.compileOrUploadRunning = true;
		if (!loadArduinoConfiguration()) {
			return;
		}
		if (!arduinoProject.getBoard()) {
			window.showInformationMessage('Board info not found, cannot upload');
		}
		if(arduinoProject.isConfigurationRequired()) {
			if (!arduinoProject.getBoardConfiguration()) {
				window.showInformationMessage('Board configuration not found, cannot upload');
			}
		}
		if (!arduinoProject.getPort()) {
			window.showInformationMessage('Port not found, cannot upload');
		}

		if (this.serialMoniorAPI) {
			const port = arduinoProject.getPort();
			this.serialMoniorAPI.stopMonitoringPort(port);
		}
		try {
			uploadStatusBarItem.text = uploadStatusBarExecuting;
			await arduinoCLI.runArduinoCommand(
				() => this.cliArgs.getUploadArguments(),
				"CLI: Failed to upload", false, true, this.compileUploadChannel
			);
			uploadStatusBarItem.text = uploadStatusBarNotExecuting;
			if (this.serialMoniorAPI) {
				this.serialMoniorAPI.startMonitoringPort({ port: arduinoProject.getPort(), baudRate: 115200, lineEnding: LineEnding.None, dataBits: 8, stopBits: StopBits.One, parity: Parity.None }).then((port) => {
				});
			}
		} catch (error) {
			uploadStatusBarItem.text = uploadStatusBarNotExecuting;
			console.log(error);
		}
		this.compileOrUploadRunning = false;
	}
	public generateIntellisense() {
		this.createIntellisenseFile();
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
				"CLI : Failed to get arduino configuration information"
			);
		} catch (error) {
			window.showErrorMessage(`Failed to install zip library: ${error}`);
		}
	}

	private async checkArduinoCLICommand(): Promise<ArduinoCLIStatus> {
		const result = await this.runArduinoCommand(
			() => this.cliArgs.getVersionArguments(),
			"CLI : Failed to get Arduino CLI version information"
		);
		arduinoCLI.getCoreUpdate();
		return (JSON.parse(result));
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
			const result = await this.executeArduinoCommand(`${arduinoCLI.arduinoCLIPath}`, configBoardArgs, true, false);

			if (!result) {
				window.showErrorMessage(`CLI : No result from get board configuration`);
				throw new Error("Command result empty");
			}
			// updateStateCompileUpload();
			return result;

		} catch (error: any) {
			window.showErrorMessage(`CLI : Error from get board configuration, you may have to installed the board using the board manager`);
			throw error;
		}
	}
	private async runArduinoCommand(
		getArguments: () => string[],
		errorMessagePrefix: string,
		returnOutput: boolean = true,
		showOutput: boolean = false,
		channel: OutputChannel = this.arduinoCLIChannel,
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
				this._lastCLIError = `Unsupported platform: ${platform}`;
				break;
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
			window.showErrorMessage(`CLI: Failed to create new sketch - ${error.message}`);
			throw error;
		}
	}

	private executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = this.arduinoCLIChannel, successMsg: string = ""): Promise<string | void> {
		// outputChannel.clear();
		if (showOutput) {
			channel.show(true);
		}
		this.arduinoCLIChannel.appendLine('');
		this.arduinoCLIChannel.appendLine('Running Arduino CLI...');
		this.arduinoCLIChannel.appendLine(`${command}`);
		this.arduinoCLIChannel.appendLine(args.join(' '));

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

	private createCompileResult(result:boolean) {
		const compileResult:CompileResult = {result:result};
		const resultFile = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), COMPILE_RESULT_FILE);
		fs.writeFileSync(resultFile, JSON.stringify(compileResult, null, 2), 'utf-8');
	}

	private createIntellisenseFile() {
		const includePaths = new Set<string>();
		let compilerPath = '';

		try {
			// Read build.options.json file and dynamically add paths
			const includeDataPath = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "build.options.json");
			const includeData: BuildOptions = JSON.parse(fs.readFileSync(includeDataPath, 'utf8'));
			if (includeData.hardwareFolders) {
				includePaths.add(`${includeData.hardwareFolders}/**`);
			}
			if (includeData.otherLibrariesFolders) {
				includePaths.add(`${includeData.otherLibrariesFolders}/**`);
			}
			if (includeData.sketchLocation) {
				includePaths.add(`${includeData.sketchLocation}/**`);
			}
		} catch (error) {
			window.showErrorMessage('Cannot generate IntelliSense: build.options.json not found');
			return;
		}

		try {
			// Read compile_commands.json file to extract the compilerPath
			const compileCommandJson = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "compile_commands.json");
			const compileInfo = JSON.parse(fs.readFileSync(compileCommandJson, 'utf8'));
			for (const entry of compileInfo) {
				if (entry.arguments && Array.isArray(entry.arguments) && entry.arguments.length > 0) {
					compilerPath = entry.arguments[0]; // Take the first argument
					break; // Stop after finding the first valid entry
				}
			}
		} catch (error) {
			window.showErrorMessage('Cannot generate IntelliSense: compile_commands.json not found');
			return;
		}

		// Create c_cpp_properties.json 
		const cppProperties = {
			configurations: [{
				name: "Arduino",
				includePath: Array.from(includePaths), 
				compilerPath: compilerPath,
				cStandard: "c17",
				cppStandard: "c++17",
			}],
			version: 4
		};
		// Write to c_cpp_properties.json
		const cppPropertiesPath = path.join(arduinoProject.getProjectPath(), VSCODE_FOLDER, CPP_PROPERTIES);
		fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));
	}

	private createIntellisenseFile_2() {
		const includePaths = new Set<string>();
		let compilerPath = '';

		try {
			// Read includes.cache file and dynamically add paths
			const includeDataPath = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "includes.cache");
			const includeData = JSON.parse(fs.readFileSync(includeDataPath, 'utf8'));
			includeData.forEach((entry: any) => {
				if (entry.Includepath) {
					// Dynamically calculate the most common denominator
					const commonDenominator = this.getCommonDenominator(entry.Includepath);
					includePaths.add(`${commonDenominator}/**`);
				}
			});
		} catch (error) {
			window.showErrorMessage('Cannot generate IntelliSense: includes.cache not found');
			return;
		}

		try {
			// Read compile_commands.json file to extract the compilerPath
			const compileCommandJson = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput(), "compile_commands.json");
			const compileInfo = JSON.parse(fs.readFileSync(compileCommandJson, 'utf8'));
			for (const entry of compileInfo) {
				if (entry.arguments && Array.isArray(entry.arguments) && entry.arguments.length > 0) {
					compilerPath = entry.arguments[0]; // Take the first argument
					break; // Stop after finding the first valid entry
				}
			}
		} catch (error) {
			window.showErrorMessage('Cannot generate IntelliSense: compile_commands.json not found');
			return;
		}

		// Create c_cpp_properties.json with the simplified paths
		const cppProperties = {
			configurations: [{
				name: "Arduino",
				includePath: Array.from(includePaths), // Use the Set to ensure unique paths
				compilerPath: compilerPath,
				cStandard: "c17",
				cppStandard: "c++17",
			}],
			version: 4
		};

		// Write to c_cpp_properties.json
		const cppPropertiesPath = path.join(arduinoProject.getProjectPath(), VSCODE_FOLDER, CPP_PROPERTIES);
		fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));
	}

	/**
	 * Dynamically calculate the most common denominator of a given path.
	 */
	private getCommonDenominator(pathString: string): string {
		const parts = pathString.split(path.sep);
		let commonPath = parts[0];

		// Dynamically build the common path by iterating through the segments
		for (let i = 1; i < parts.length - 1; i++) {
			commonPath = path.join(commonPath, parts[i]);

			// If this directory is likely a project root, stop further processing
			// (Can customize this condition based on specific needs)
			if (this.isLikelyRoot(parts[i])) {
				break;
			}
		}

		return commonPath;
	}

	/**
	 * Check if the current directory segment is likely a root for includes.
	 */
	private isLikelyRoot(directorySegment: string): boolean {
		// Customize conditions for identifying a root (e.g., "libraries" or specific keywords).
		return directorySegment.toLowerCase().includes("packages") || directorySegment.toLowerCase().includes("arduino");
	}


	private createIntellisenseFile_old(compileJsonOutput: string) {
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
}

// public generateCppPropertiesFromCompileOutput(output: string) {
//     const defines: string[] = [];

//     // Regular expressions to match include paths and defines
//     const defineRegex = /-D([^\s]+)/g;
//     const includeRegex = /"-I([^"]+)"/g;

//     const includePaths = new Set();

//     let match;

//     while ((match = includeRegex.exec(output)) !== null) {
//         let path = match[1]; // Capture the path inside the quotes

//         // Normalize the path (handle backslashes, especially on Windows)
//         path = path.replace(/\\\\/g, "\\"); // Convert backslashes to forward slashes for consistency

//         includePaths.add(path + "\\**"); // Use a Set to avoid duplicates
//     }

//     while ((match = defineRegex.exec(output)) !== null) {
//         defines.push(match[1]);
//     }

//     includePaths.add(this.getProjectPath() + "\\**");
//     try {
//         const includeDataPath = path.join(this.getProjectPath(), this.getOutput(), "includes.cache");
//         const includeData = JSON.parse(fs.readFileSync(includeDataPath, 'utf8'));
//         includeData.forEach((entry: any) => {
//             if (entry.Includepath) {
//                 includePaths.add(entry.Includepath + "\\**");
//             }
//         });

//     } catch (error) {
//         vscode.window.showErrorMessage('Cannot generate IntelliSense includes.cache not found');
//         return;
//     }

//     // Create c_cpp_properties.json
//     const cppProperties = {
//         configurations: [{
//             name: "Arduino",
//             includePath: Array.from(includePaths),
//             defines: defines,
//             // compilerPath: "/path/to/compiler",  // You can retrieve this from output if needed
//             cStandard: "c17",
//             cppStandard: "c++17",
//             intelliSenseMode: "gcc-x86"
//         }],
//         version: 4
//     };

//     const cppPropertiesPath = path.join(this.getProjectPath(), VSCODE_FOLDER, CPP_PROPERTIES);
//     fs.writeFileSync(cppPropertiesPath, JSON.stringify(cppProperties, null, 2));

//     vscode.window.showInformationMessage('Generated c_cpp_properties.json for IntelliSense.');
// }