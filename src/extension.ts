import * as vscode from 'vscode';
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

export function activate(context: vscode.ExtensionContext) {
	// Create an output channel
	const outputChannel = vscode.window.createOutputChannel('Arduino');

	// Register the compile command
	let disposable = vscode.commands.registerCommand('vscode-arduino.compile', () => {

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			vscode.window.showErrorMessage('No workspace folder is open.');
			return;
		}

		const workspacePath = workspaceFolders[0].uri.fsPath;
		const configPath = path.join(workspacePath, '.vscode', 'arduino.json');

		// Check if the arduino.json file exists
		if (!fs.existsSync(configPath)) {
			vscode.window.showErrorMessage('arduino.json file not found in .vscode folder.');
			return;
		}

		// Read the arduino.json file
		const configContent = fs.readFileSync(configPath, 'utf-8');
		let config;
		try {
			config = JSON.parse(configContent);
		} catch (error) {
			vscode.window.showErrorMessage('Error parsing arduino.json.');
			return;
		}

		// Extract relevant fields from arduino.json
		const configuration = config.configuration || '';
		const board = config.board || '';
		const output = config.output || 'build';
		const port = config.port || '';

		if (!board || !output || !port || !configuration) {
			vscode.window.showErrorMessage('Missing required configuration in arduino.json (board, configuration, or port).');
			return;
		}


		vscode.window.showInformationMessage('Compiling Arduino project...');
		outputChannel.clear();
		outputChannel.appendLine('Running Arduino CLI compile...');
		outputChannel.show(true);

		const sketchPath = path.join(workspacePath);
        const compileCommand = `arduino-cli compile -v --fqbn ${board}:${configuration} --build-path ${output} \"${sketchPath}\"`;

		// Execute the Arduino CLI command
		cp.exec(compileCommand, (error: string, stdout: string, stderr: string) => {
			if (error) {
				outputChannel.appendLine(`Error: ${stderr}`);
				vscode.window.showErrorMessage(`Compilation failed. Check Output window for details.`);
				return;
			}

			// Write stdout to the output channel
			outputChannel.appendLine(stdout);

			// Show a success message in the information box
			vscode.window.showInformationMessage('Compilation successful.');
		});
	});

	// Push the disposable command to the context's subscriptions
	context.subscriptions.push(disposable);
}

export function deactivate() { }

