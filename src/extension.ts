import { window, ExtensionContext, commands, Disposable, workspace, Uri } from "vscode";
import { ArduinoProject } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { compileCommandCleanName, compileCommandName, intellisenseCommandName, QuickAccessProvider, uploadCommandName } from './quickAccessProvider';
import { ARDUINO_ERRORS, ArduinoExtensionChannelName } from "./shared/messages";
import { ArduinoCLI } from "./cli";

export const arduinoExtensionChannel = window.createOutputChannel(ArduinoExtensionChannelName);
arduinoExtensionChannel.appendLine("Arduino Extension started");
const quickAccessProvider = new QuickAccessProvider();

export const arduinoProject: ArduinoProject = new ArduinoProject();
export let arduinoCLI: ArduinoCLI;

export function activate(context: ExtensionContext) {
	arduinoCLI = new ArduinoCLI(context);
	if (arduinoCLI.isCLIReady()) {
		arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${arduinoCLI.arduinoCLIPath}`);
	} else {
		arduinoProject.setStatus(ARDUINO_ERRORS.CLI_NOT_WORKING);
		arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
	}
	
	if(arduinoCLI.isConfigReady()) {
		arduinoProject.setStatus(ARDUINO_ERRORS.CONFIG_FILE_PROBLEM);
		arduinoExtensionChannel.appendLine(`Arduino Config file is good`);
	} else {
		arduinoExtensionChannel.appendLine(`${arduinoCLI.lastCLIError()}`);
	}

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

}

export function updateStateCompileUpload() {
	arduinoProject.readConfiguration();
	if (arduinoProject.isFolderArduinoProject() === ARDUINO_ERRORS.NO_ERRORS &&
		arduinoProject.getArduinoConfiguration().board.trim() !== '' &&
		arduinoProject.getArduinoConfiguration().configuration.trim() !== '') {
		quickAccessProvider.enableItem(compileCommandName);
		quickAccessProvider.enableItem(compileCommandCleanName);
		if(arduinoProject.isUploadReady()) {
			quickAccessProvider.enableItem(uploadCommandName);
		}
		quickAccessProvider.enableItem(intellisenseCommandName);
	} else {
		quickAccessProvider.disableItem(compileCommandName);
		quickAccessProvider.disableItem(compileCommandCleanName);
		quickAccessProvider.disableItem(uploadCommandName);
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

function vsGenerateIntellisense(): Disposable {
	return commands.registerCommand('intellisense', () => {
		arduinoCLI.generateIntellisense();
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

