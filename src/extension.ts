import * as vscode from 'vscode';
const cp = require('child_process')

export function activate(context: vscode.ExtensionContext) {
    // Create an output channel
    const outputChannel = vscode.window.createOutputChannel('Arduino CLI');

    // Register the compile command
    let disposable = vscode.commands.registerCommand('vscode-arduino.compile', () => {
        vscode.window.showInformationMessage('Compiling Arduino project...');
        
        // Clear the output channel before running the command
        outputChannel.clear();

        // Append initial message to the output channel
        outputChannel.appendLine('Running Arduino CLI compile...');

        // Show the output channel
        outputChannel.show(true);

        // Execute the Arduino CLI command
        cp.exec('arduino-cli compile -v', (error, stdout, stderr) => {
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

export function deactivate() {}

