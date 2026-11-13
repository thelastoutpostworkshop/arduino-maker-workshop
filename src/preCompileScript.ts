import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import type { CancellationToken, Disposable } from 'vscode';

const STDERR_LIMIT = 8192;
const TERMINATION_GRACE_MS = 1000;

export class PreCompileScriptCancelledError extends Error {
	constructor() {
		super('Pre-compile script was cancelled by the user.');
		this.name = 'PreCompileScriptCancelledError';
	}
}

interface PreCompileScriptOptions {
	cwd: string;
	token: CancellationToken;
	onOutput: (chunk: string) => void;
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-pid, signal);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
			return false;
		}
		throw error;
	}
}

async function terminateProcessTree(pid: number): Promise<void> {
	if (process.platform === 'win32') {
		const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
		await new Promise<void>((resolve, reject) => {
			execFile(taskkill, ['/PID', String(pid), '/T', '/F'], {
				windowsHide: true,
				timeout: 10000,
				maxBuffer: 16384,
			}, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr.trim() || stdout.trim() || error.message));
				} else {
					resolve();
				}
			});
		});
		return;
	}

	if (!signalProcessGroup(pid, 'SIGTERM')) {
		return;
	}
	const deadline = Date.now() + TERMINATION_GRACE_MS;
	while (Date.now() < deadline) {
		await new Promise<void>(resolve => setTimeout(resolve, 50));
		if (!signalProcessGroup(pid, 0)) {
			return;
		}
	}
	// The shell can exit before a descendant that ignores SIGTERM. Signal the
	// entire original group even when the shell's close event has already fired.
	signalProcessGroup(pid, 'SIGKILL');
}

export async function runPreCompileScript(command: string, options: PreCompileScriptOptions): Promise<void> {
	if (options.token.isCancellationRequested) {
		throw new PreCompileScriptCancelledError();
	}

	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, [], {
			cwd: options.cwd,
			shell: true,
			windowsHide: true,
			detached: process.platform !== 'win32',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stderrOutput = '';
		let processError: Error | undefined;
		let cancellationError: Error | undefined;
		let cancellationRequested = false;
		let cancellationFinished = false;
		let closed = false;
		let settled = false;
		let exitCode: number | null = null;
		let exitSignal: NodeJS.Signals | null = null;
		let cancellationListener: Disposable | undefined;
		const emitOutput = (chunk: string) => {
			try {
				options.onOutput(chunk);
			} catch (error) {
				processError ??= error instanceof Error ? error : new Error(String(error));
			}
		};

		const finish = () => {
			if (settled || !closed || (cancellationRequested && !cancellationFinished)) {
				return;
			}
			settled = true;
			cancellationListener?.dispose();
			if (cancellationRequested) {
				reject(cancellationError ?? new PreCompileScriptCancelledError());
			} else if (processError) {
				reject(new Error(`Pre-compile script failed: ${processError.message}`));
			} else if (exitCode !== 0) {
				const status = exitSignal ? `signal ${exitSignal}` : `error code ${exitCode}`;
				const details = stderrOutput.trim();
				reject(new Error(`Pre-compile script returned ${status}${details ? `: ${details}` : '.'}`));
			} else {
				resolve();
			}
		};

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', emitOutput);
		child.stderr.on('data', (chunk: string) => {
			stderrOutput = (stderrOutput + chunk).slice(-STDERR_LIMIT);
			emitOutput(chunk);
		});
		child.once('error', (error: Error) => {
			processError = error;
		});
		child.once('close', (code, signal) => {
			closed = true;
			exitCode = code;
			exitSignal = signal;
			finish();
		});

		const cancel = () => {
			if (settled || cancellationRequested) {
				return;
			}
			cancellationRequested = true;
			const termination = child.pid ? terminateProcessTree(child.pid) : Promise.resolve();
			void termination.then(() => {
				cancellationFinished = true;
				finish();
			}, (error: unknown) => {
				const details = error instanceof Error ? error.message : String(error);
				cancellationError = new Error(`Unable to stop the pre-compile script: ${details}`);
				cancellationFinished = true;
				// Keep the operation busy until close if tree termination failed.
				// Killing only the shell here would leave its descendants running.
				emitOutput(`${cancellationError.message}\nWaiting for the script to exit.\n`);
				finish();
			});
		};
		cancellationListener = options.token.onCancellationRequested(cancel);
		// Covers cancellation between the initial check and listener registration.
		if (options.token.isCancellationRequested) {
			cancel();
		}
	});
}
