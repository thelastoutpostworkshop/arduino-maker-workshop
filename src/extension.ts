import { window, ExtensionContext, commands, Disposable, workspace, Uri, ProgressLocation } from "vscode";
import { ArduinoProject, CPP_PROPERTIES, VSCODE_FOLDER } from './ArduinoProject';
import { VueWebviewPanel } from './VueWebviewPanel';
import { compileCommandCleanName, compileCommandName, intellisenseCommandName, QuickAccessProvider, uploadCommandName } from './quickAccessProvider';
import { ARDUINO_ERRORS, Compile } from "./shared/messages";
import { ArduinoCLI } from "./cli";

const path = require('path');
const os = require('os');
const fs = require('fs');

export const arduinoCLIChannel = window.createOutputChannel('Arduino CLI');
export const compileUploadChannel = window.createOutputChannel('Arduino Compile & Upload');
export const arduinoExtensionChannel = window.createOutputChannel('Arduino Extension');
arduinoExtensionChannel.appendLine("Arduino Extension started");
const quickAccessProvider = new QuickAccessProvider();

export const arduinoProject: ArduinoProject = new ArduinoProject();
export let arduinoCLI:ArduinoCLI;

export function activate(context: ExtensionContext) {
	const config = workspace.getConfiguration();
	arduinoCLI = new ArduinoCLI(context);
	try {
		arduinoExtensionChannel.appendLine(`Arduino CLI Path: ${arduinoCLI.arduinoCLIPath}`);
	} catch (error: any) {
		arduinoExtensionChannel.appendLine(error);
		window.showErrorMessage(error);
		throw new Error(error);
	}

	arduinoCLI.checkArduinoConfiguration();

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
		quickAccessProvider.enableItem(uploadCommandName);
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
		generateIntellisense();
	});
}

export function generateIntellisense() {
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
			const output = await arduinoCLI.runArduinoCommand(
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
		arduinoCLI.compile(true);
	});
}
function vsCommandCompile(clean: boolean = false): Disposable {
	return commands.registerCommand('quickAccessView.compile', async () => {
		arduinoCLI.compile(false);
	});
}

export function deactivate() { }

