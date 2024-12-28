import { window, ExtensionContext, commands, Disposable, workspace, Uri, StatusBarAlignment, ColorThemeKind } from "vscode";
import { ArduinoProject } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { compileCommandCleanName, quickAccessCompileCommandName, intellisenseCommandName, QuickAccessProvider, quickAccessUploadCommandName } from './quickAccessProvider';
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, ArduinoExtensionChannelName, THEME_COLOR } from "./shared/messages";
import { ArduinoCLI } from "./cli";

export const compileCommandName: string = 'quickAccessView.compile';
export const uploadCommandName: string = 'quickAccessView.upload';

export const compileStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
export const compileStatusBarNotExecuting: string = "$(check) Compile";
export const compileStatusBarExecuting: string = "$(sync~spin) Compiling";
export const uploadStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
export const uploadStatusBarNotExecuting: string = "$(cloud-upload) Upload";
export const uploadStatusBarExecuting: string = "$(sync~spin) Uploading";

export const arduinoExtensionChannel = window.createOutputChannel(ArduinoExtensionChannelName);
arduinoExtensionChannel.appendLine("Arduino Extension started");
const quickAccessProvider = new QuickAccessProvider();

export const arduinoProject: ArduinoProject = new ArduinoProject();
export let arduinoCLI: ArduinoCLI;

export async function activate(context: ExtensionContext) {
	arduinoCLI = new ArduinoCLI(context);
	if (await arduinoCLI.isCLIReady()) {
		arduinoExtensionChannel.appendLine(`Arduino CLI is ready, path: ${arduinoCLI.arduinoCLIPath}`);
		if (await arduinoCLI.isConfigReady()) {
			arduinoExtensionChannel.appendLine(`Arduino Config file is good`);

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

			compileStatusBarItem.text = compileStatusBarNotExecuting;
			compileStatusBarItem.command = compileCommandName;
			compileStatusBarItem.tooltip = "Compile the current sketch";
			context.subscriptions.push(compileStatusBarItem);

			uploadStatusBarItem.text = uploadStatusBarNotExecuting;
			uploadStatusBarItem.command = uploadCommandName;
			uploadStatusBarItem.tooltip = "Upload to the board";
			context.subscriptions.push(uploadStatusBarItem);

			context.subscriptions.push(
				commands.registerCommand('extension.openVueWebview', () => {
					VueWebviewPanel.render(context);
				})
			);

			window.registerTreeDataProvider('quickAccessView', quickAccessProvider);
			updateStateCompileUpload();
			workspace.onDidChangeTextDocument((document) => {
				if (document.document.fileName === arduinoProject.getarduinoConfigurationPath()) {
					// Arduino configuration file has changed, recompile is necessary
					arduinoCLI.setCompileResult(false);
					updateStateCompileUpload();
				}
			});

			// Listening to theme change events
			window.onDidChangeActiveColorTheme((colorTheme) => {
				changeTheme(colorTheme.kind);
			});
			// await commands.executeCommand('extension.openVueWebview');

		} else {
			arduinoProject.setStatus(ARDUINO_ERRORS.CONFIG_FILE_PROBLEM);
			arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
		}
	} else {
		arduinoProject.setStatus(ARDUINO_ERRORS.CLI_NOT_WORKING);
		arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
	}

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
			quickAccessProvider.enableItem(quickAccessCompileCommandName);
			quickAccessProvider.enableItem(compileCommandCleanName);
			compileStatusBarItem.show();
		} else {
			quickAccessProvider.disableItem(quickAccessCompileCommandName);
			quickAccessProvider.disableItem(compileCommandCleanName);
			compileStatusBarItem.hide();
		}
		if (arduinoProject.isUploadReady()) {
			quickAccessProvider.enableItem(quickAccessUploadCommandName);
			uploadStatusBarItem.show();
		} else {
			quickAccessProvider.disableItem(quickAccessUploadCommandName);
			uploadStatusBarItem.hide();
		}
		quickAccessProvider.enableItem(intellisenseCommandName);
	} else {
		compileStatusBarItem.hide();
		quickAccessProvider.disableItem(quickAccessCompileCommandName);
		quickAccessProvider.disableItem(compileCommandCleanName);
		quickAccessProvider.disableItem(quickAccessUploadCommandName);
		quickAccessProvider.disableItem(intellisenseCommandName);
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

function vsCommandUpload(): Disposable {
	return commands.registerCommand('quickAccessView.upload', async () => {
		arduinoCLI.upload();
	});
}

function vsCommandCompileClean(): Disposable {
	return commands.registerCommand('compile.clean', async () => {
		arduinoCLI.compile(true);
	});
}
function vsCommandCompile(clean: boolean = false): Disposable {
	return commands.registerCommand('quickAccessView.compile', async () => {
		arduinoCLI.compile(false);
	});
}

export function deactivate() { }

