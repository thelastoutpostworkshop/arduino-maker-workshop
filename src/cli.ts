import { OutputChannel, window } from "vscode";
import { arduinoCLIChannel } from "./extension";
const fs = require('fs');
const cp = require('child_process');

export function executeArduinoCommand(command: string, args: string[], returnOutput: boolean = false, showOutput = true, channel: OutputChannel = arduinoCLIChannel, successMsg: string = ""): Promise<string | void> {
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