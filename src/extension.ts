import { window, ExtensionContext, commands, Disposable, workspace, Uri, StatusBarAlignment, ColorThemeKind, ConfigurationTarget } from "vscode";
import { ArduinoProject, UPLOAD_READY_STATUS } from './ArduinoProject';
import { sendBuildProfiles, VueWebviewPanel } from './VueWebviewPanel';
import { compileCommandCleanName, quickAccessCompileCommandName, QuickAccessProvider, quickAccessUploadCommandName } from './quickAccessProvider';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoExtensionChannelName, PROFILES_STATUS, THEME_COLOR, WebviewToExtensionMessage, YAML_FILENAME, YAML_FILENAME_INACTIVE } from "./shared/messages";
import { ArduinoCLI } from "./cli";
import { SketchProfileManager } from "./sketchProfileManager";

const os = require('os');

const watchedExtensions = ['.cpp', '.h', '.ino']; // List of extensions to watch for invalidating the build
export const compileCommandName: string = 'quickAccessView.compile';
export const uploadCommandName: string = 'quickAccessView.upload';
export const profileCommandName: string = 'quickAccessView.profile';

export const compileStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
export const compileStatusBarNotExecuting: string = "$(check) Compile";
export const compileStatusBarExecuting: string = "$(sync~spin) Compiling";
export const uploadStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
export const uploadStatusBarNotExecuting: string = "$(cloud-upload) Upload";
export const uploadStatusBarExecuting: string = "$(sync~spin) Uploading";
export const profileStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);

export const arduinoExtensionChannel = window.createOutputChannel(ArduinoExtensionChannelName);
arduinoExtensionChannel.appendLine(`Arduino Extension started on ${os.platform}`);
const quickAccessProvider = new QuickAccessProvider();

export const arduinoProject: ArduinoProject = new ArduinoProject();
export const arduinoYaml: SketchProfileManager = new SketchProfileManager();
export let arduinoCLI: ArduinoCLI;

let debounceTimeout: NodeJS.Timeout | undefined; // To debounce changes to settings

export async function activate(context: ExtensionContext) {
	arduinoCLI = new ArduinoCLI(context);
	if (await arduinoCLI.isCLIReady()) {
		arduinoExtensionChannel.appendLine(`Arduino CLI is ready, path: ${arduinoCLI.arduinoCLIPath}`);
		if (await arduinoCLI.isConfigReady()) {
			arduinoExtensionChannel.appendLine(`Arduino Config file is good`);
			await verifyUserDirectorySetting();
			checkYamlStatus();

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
			context.subscriptions.push(vsCommandProfile());

			compileStatusBarItem.text = compileStatusBarNotExecuting;
			compileStatusBarItem.command = compileCommandName;
			context.subscriptions.push(compileStatusBarItem);

			uploadStatusBarItem.text = uploadStatusBarNotExecuting;
			uploadStatusBarItem.command = uploadCommandName;
			context.subscriptions.push(uploadStatusBarItem);

			profileStatusBarItem.text = "$(code-oss) Profile";
			profileStatusBarItem.command = profileCommandName;
			context.subscriptions.push(profileStatusBarItem);

			context.subscriptions.push(
				commands.registerCommand('extension.openVueWebview', () => {
					VueWebviewPanel.render(context);
				})
			);

			window.registerTreeDataProvider('quickAccessView', quickAccessProvider);
			updateStateCompileUpload();

			// Listen to file modifications
			workspace.onDidChangeTextDocument((event) => {
				if (isWatchedExtension(event.document.uri.fsPath)) {
					// A source file has changed, recompile is necessary
					arduinoCLI.setBuildResult(false);
					updateStateCompileUpload();

				}
			});

			// Listen for new files being created
			context.subscriptions.push(
				workspace.onDidCreateFiles((event) => {
					event.files.forEach((file) => {
						if (isWatchedExtension(file.fsPath)) {
							// A new file has been created, recompile is necessary
							arduinoCLI.setBuildResult(false);
							updateStateCompileUpload();
						}
					});
				})
			);

			// Listen for files being deleted
			context.subscriptions.push(
				workspace.onDidDeleteFiles((event) => {
					event.files.forEach((file) => {
						if (isWatchedExtension(file.fsPath)) {
							// A file has been deleted, recompile is necessary
							arduinoCLI.setBuildResult(false);
							updateStateCompileUpload();
						}
					});
				})
			);

			// Listen for files being renamed
			context.subscriptions.push(
				workspace.onDidRenameFiles((event) => {
					event.files.forEach(({ oldUri, newUri }) => {
						if (isWatchedExtension(oldUri.fsPath) || isWatchedExtension(newUri.fsPath)) {
							// A file has been renamed, recompile is necessary
							arduinoCLI.setBuildResult(false);
							updateStateCompileUpload();
						}
					});
				})
			);

			watchSketchYamlFile(context);

			// Listening to theme change events
			window.onDidChangeActiveColorTheme((colorTheme) => {
				changeTheme(colorTheme.kind);
			});

			workspace.onDidChangeConfiguration((event) => {
				// Check if the `arduinoMakerWorkshop.arduinoCLI.executable` setting has changed
				if (debounceTimeout) {
					clearTimeout(debounceTimeout);
				}

				debounceTimeout = setTimeout(async () => {
					if (event.affectsConfiguration('arduinoMakerWorkshop.arduinoCLI.executable')) {
						if (await arduinoCLI.isCLIReady()) {
							arduinoExtensionChannel.appendLine(`Arduino CLI is ready, path: ${arduinoCLI.arduinoCLIPath}`);
							window.showInformationMessage(`Arduino CLI executable changed to: ${arduinoCLI.arduinoCLIPath}`);
						}
					} else {
						arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
					}

					if (event.affectsConfiguration('arduinoMakerWorkshop.arduinoCLI.installPath')) {
						if (await arduinoCLI.isCLIReady()) {
							arduinoExtensionChannel.appendLine(`Arduino CLI is ready, path: ${arduinoCLI.arduinoCLIPath}`);
							window.showInformationMessage(`Arduino CLI executable changed to: ${arduinoCLI.arduinoCLIPath}`);
						} else {
							arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
						}
					}
					if (event.affectsConfiguration('arduinoMakerWorkshop.arduinoCLI.userDirectory')) {
						changeUserDirectory();
					}
					// if (event.affectsConfiguration('arduinoMakerWorkshop.buildProfilesInactiveFolder')) {
					// 	arduinoYaml.setupInactiveFolder();
					// }
				}, 500); // Debounce delay (500ms here)
			});

		} else {
			arduinoProject.setStatus(ARDUINO_ERRORS.CONFIG_FILE_PROBLEM);
			arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
		}
	} else {
		arduinoProject.setStatus(ARDUINO_ERRORS.CLI_NOT_WORKING);
		arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
	}

}

function checkYamlStatus() {
	arduinoYaml.getYaml(); // This will check if the YAML file has errors
	const errors = arduinoYaml.getLastError();
	if (errors) {
		arduinoExtensionChannel.appendLine(`The ${YAML_FILENAME} file has errors : ${errors}`);
	}
	const yamlStatus = arduinoYaml.status();
	switch (yamlStatus) {
		case PROFILES_STATUS.ACTIVE:
			arduinoExtensionChannel.appendLine(`A ${YAML_FILENAME} file is active`);
			break;
		case PROFILES_STATUS.INACTIVE:
			arduinoExtensionChannel.appendLine(`A ${YAML_FILENAME} file is inactive`);
			break;
		case PROFILES_STATUS.NOT_AVAILABLE:
			arduinoExtensionChannel.appendLine(`No ${YAML_FILENAME} found`);
			break;
		default:
			arduinoExtensionChannel.appendLine(`Uknown yaml status ${yamlStatus}`);
			break;
	}
}

function watchSketchYamlFile(context: ExtensionContext) {
	const watcherPattern = `**/{${YAML_FILENAME},${YAML_FILENAME_INACTIVE}}`;
	const sketchYamlWatcher = workspace.createFileSystemWatcher(watcherPattern);

	let debounceTimer: NodeJS.Timeout | null = null;

	function debouncedSendBuildProfiles() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			sendBuildProfiles();
			debounceTimer = null;
		}, 200); // 200-500ms debounce is usually enough
	}

	const changeDisposable = sketchYamlWatcher.onDidChange((uri) => {
		// arduinoExtensionChannel.appendLine(`sketch.yaml changed: ${uri.fsPath}`);
		debouncedSendBuildProfiles();
	});

	const createDisposable = sketchYamlWatcher.onDidCreate((uri) => {
		// arduinoExtensionChannel.appendLine(`sketch.yaml created: ${uri.fsPath}`);
		debouncedSendBuildProfiles();
	});

	const deleteDisposable = sketchYamlWatcher.onDidDelete((uri) => {
		// arduinoExtensionChannel.appendLine(`sketch.yaml deleted: ${uri.fsPath}`);
		debouncedSendBuildProfiles();
	});

	context.subscriptions.push(
		sketchYamlWatcher,
		changeDisposable,
		createDisposable,
		deleteDisposable
	);
}

async function verifyUserDirectorySetting() {
	const userDirectory = await arduinoCLI.getConfigUserDirectory();
	if (userDirectory) {
		arduinoExtensionChannel.appendLine(`User directory is: ${userDirectory}`);
		const config = workspace.getConfiguration('arduinoMakerWorkshop.arduinoCLI');
		const currentValue = config.get<string>('userDirectory', '');
		// Only update if the current value is different
		if (currentValue.trim() !== userDirectory.trim()) {
			await config.update('userDirectory', userDirectory, ConfigurationTarget.Global);
			arduinoExtensionChannel.appendLine(`User directory setting updated to: ${userDirectory}`);
		}
	}
}

export function shouldDetectPorts(): boolean {
	const config = workspace.getConfiguration('arduinoMakerWorkshop');
	const disableAutoPortDetection = config.get<boolean>('disableAutoPortDetection', false);

	// Only disable port detection on Windows if the setting is enabled
	if (os.platform() === 'win32' && disableAutoPortDetection) {
		return false; // Skip port detection
	}

	return true; // Proceed with port detection
}

function changeUserDirectory() {
	const config = workspace.getConfiguration('arduinoMakerWorkshop.arduinoCLI');
	const userDirectory = config.get<string>('userDirectory', '');
	if (userDirectory.trim().length > 0) {
		if (VueWebviewPanel.currentPanel) {
			VueWebviewPanel.currentPanel.dispose();
			VueWebviewPanel.currentPanel = undefined;
		}
		arduinoCLI.setConfigUserDirectory(userDirectory);
		arduinoCLI.clearLibraryCache();
		window.showInformationMessage(`User directory set to: ${userDirectory}`);
	}
}

function isWatchedExtension(filePath: string): boolean {
	return watchedExtensions.some((ext) => filePath.endsWith(ext));
}

export function changeTheme(themeKind: ColorThemeKind) {
	if (VueWebviewPanel.currentPanel) {
		switch (themeKind) {
			case ColorThemeKind.Dark:
				VueWebviewPanel.sendMessage({ command: ARDUINO_MESSAGES.CHANGE_THEME_COLOR, errorMessage: "", payload: THEME_COLOR.dark });
				break;
			case ColorThemeKind.Light:
				VueWebviewPanel.sendMessage({ command: ARDUINO_MESSAGES.CHANGE_THEME_COLOR, errorMessage: "", payload: THEME_COLOR.light });
				break;
			case ColorThemeKind.HighContrast:
				VueWebviewPanel.sendMessage({ command: ARDUINO_MESSAGES.CHANGE_THEME_COLOR, errorMessage: "", payload: THEME_COLOR.highContrast });
				break;
		}
	}
}
export function updateStateCompileUpload() {
	arduinoProject.readConfiguration();
	if (arduinoProject.isFolderArduinoProject() === ARDUINO_ERRORS.NO_ERRORS) {
		if (arduinoProject.isCompileReady()) {
			if (arduinoYaml.status() == PROFILES_STATUS.ACTIVE) {
				compileStatusBarItem.tooltip = `Compile profile ${arduinoProject.getCompileProfile()}`;
				uploadStatusBarItem.tooltip = `Upload  ${arduinoProject.getCompileProfile()} to the board`;
			} else {
				compileStatusBarItem.tooltip = `Compile the current sketch`;
				uploadStatusBarItem.tooltip = "Upload to the board";
			}

			quickAccessProvider.enableItem(quickAccessCompileCommandName);
			quickAccessProvider.enableItem(compileCommandCleanName);
			quickAccessProvider.enableItem(quickAccessUploadCommandName);
			compileStatusBarItem.show();
			uploadStatusBarItem.show();
			profileStatusBarItem.show();

		} else {
			quickAccessProvider.disableItem(quickAccessCompileCommandName);
			quickAccessProvider.disableItem(compileCommandCleanName);
			quickAccessProvider.disableItem(quickAccessUploadCommandName);
			compileStatusBarItem.hide();
			uploadStatusBarItem.hide();
			profileStatusBarItem.hide();
		}
	} else {
		uploadStatusBarItem.hide();
		compileStatusBarItem.hide();
		profileStatusBarItem.hide();
		quickAccessProvider.disableItem(quickAccessCompileCommandName);
		quickAccessProvider.disableItem(compileCommandCleanName);
		quickAccessProvider.disableItem(quickAccessUploadCommandName);
	}
}

export function openExample(examplePath: string) {
	const uriPath = Uri.file(examplePath);
	commands.executeCommand('vscode.openFolder', uriPath, { forceNewWindow: true });
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

export function compile(
	clean: boolean = false,
	createBuildProfile = false
): Promise<string> {
	if (!arduinoProject.isCompileReady()) {
		window.showErrorMessage('Select a board first before compiling');
		return Promise.resolve("");
	}
	// Notify webview that compile started
	VueWebviewPanel.sendMessage({
		command: ARDUINO_MESSAGES.COMPILE_IN_PROGRESS,
		errorMessage: "",
		payload: "Compile in progress"
	});

	return arduinoCLI.compile(clean, createBuildProfile)
		.then((output: string) => {
			return output;
		})
		.catch((output) => {
			return output;
		})
		.finally(() => {
			// Always notify webview compile finished
			VueWebviewPanel.sendMessage({
				command: ARDUINO_MESSAGES.COMPILE_IN_PROGRESS,
				errorMessage: "",
				payload: ""
			});
		});
}


function vsCommandUpload(): Disposable {
	return commands.registerCommand('quickAccessView.upload', async () => {
		switch (arduinoProject.isUploadReady()) {
			case UPLOAD_READY_STATUS.READY:
				arduinoCLI.upload();
				break;
			case UPLOAD_READY_STATUS.NO_PORT:
				window.showErrorMessage("No port is selected for upload");
				break;
			case UPLOAD_READY_STATUS.LAST_COMPILE_FAILED:
				await compile();
				if (arduinoProject.isUploadReady() == UPLOAD_READY_STATUS.READY) {
					arduinoCLI.upload();
				}
				break;
			default:
				window.showErrorMessage("Cannot assess upload readiness, please recompile clean");
				break;
		}
	});
}

function vsCommandProfile(): Disposable {
	return commands.registerCommand('quickAccessView.profile', async () => {
		console.log("test");
	});
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

export function deactivate() { }

