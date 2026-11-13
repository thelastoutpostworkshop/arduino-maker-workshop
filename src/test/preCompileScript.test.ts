import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CancellationToken } from 'vscode';
import { PreCompileScriptCancelledError, runPreCompileScript } from '../preCompileScript';

class TestCancellationToken implements CancellationToken {
	public isCancellationRequested = false;
	private listeners = new Set<() => void>();
	public readonly onCancellationRequested: CancellationToken['onCancellationRequested'] = (listener, thisArgs, disposables) => {
		const callback = () => listener.call(thisArgs, undefined);
		this.listeners.add(callback);
		const disposable = { dispose: () => { this.listeners.delete(callback); } };
		disposables?.push(disposable);
		return disposable;
	};
	public cancel(): void {
		this.isCancellationRequested = true;
		for (const listener of this.listeners) {
			listener();
		}
	}

	public get listenerCount(): number {
		return this.listeners.size;
	}
}

async function withFixture(action: (directory: string) => Promise<void>): Promise<void> {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = fs.mkdtempSync(path.join(temporaryRoot, 'amw pre compile-'));
	try {
		await action(directory);
	} finally {
		assert.strictEqual(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('amw pre compile-'));
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

function scriptCommand(directory: string, source: string): string {
	const scriptPath = path.join(directory, 'script.cjs');
	fs.writeFileSync(scriptPath, source);
	const quote = (value: string) => process.platform === 'win32'
		? `"${value}"`
		: `'${value.replace(/'/g, "'\\''")}'`;
	return `${quote(process.execPath)} ${quote(scriptPath)}`;
}

suite('Pre-compile scripts', function () {
	this.timeout(15000);

	test('streams stdout and stderr before the script exits', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			let output = '';
			const command = scriptCommand(directory, `
const fs = require('node:fs');
console.log('stdout-marker');
console.error('stderr-marker');
const timeout = setTimeout(() => process.exit(9), 3000);
const poll = setInterval(() => {
  if (fs.existsSync('release')) {
    clearTimeout(timeout);
    clearInterval(poll);
  }
}, 10);
`);
			await runPreCompileScript(command, {
				cwd: directory,
				token,
				onOutput: chunk => {
					output += chunk;
					if (output.includes('stdout-marker') && output.includes('stderr-marker')) {
						fs.writeFileSync(path.join(directory, 'release'), '');
					}
				},
			});
			assert.ok(output.includes('stdout-marker'));
			assert.ok(output.includes('stderr-marker'));
			assert.strictEqual(token.listenerCount, 0);
		});
	});

	test('reports a nonzero exit with a bounded tail of stderr', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			const command = scriptCommand(directory, "process.stderr.write('x'.repeat(12000) + 'final failure'); process.exitCode = 17;");
			await assert.rejects(runPreCompileScript(command, { cwd: directory, token, onOutput: () => {} }), (error: Error) => {
				assert.match(error.message, /error code 17/);
				assert.match(error.message, /final failure/);
				assert.ok(error.message.length < 8500);
				return true;
			});
			assert.strictEqual(token.listenerCount, 0);
		});
	});

	test('does not execute an already-cancelled command', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			token.cancel();
			const command = scriptCommand(directory, "require('node:fs').writeFileSync('executed', '');");
			await assert.rejects(runPreCompileScript(command, { cwd: directory, token, onOutput: () => {} }), PreCompileScriptCancelledError);
			assert.strictEqual(fs.existsSync(path.join(directory, 'executed')), false);
			assert.strictEqual(token.listenerCount, 0);
		});
	});

	test('cancellation stops descendants before they can write after completion', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			let output = '';
			const command = scriptCommand(directory, `
if (process.argv[2] === 'descendant') {
  console.log('descendant-ready');
  setTimeout(() => require('node:fs').writeFileSync('late-write', ''), 1000);
} else {
  require('node:child_process').spawn(process.execPath, [__filename, 'descendant'], { stdio: 'inherit' });
}
`);
			await assert.rejects(runPreCompileScript(command, {
				cwd: directory,
				token,
				onOutput: chunk => {
					output += chunk;
					if (output.includes('descendant-ready')) {
						token.cancel();
					}
				},
			}), PreCompileScriptCancelledError);
			await new Promise<void>(resolve => setTimeout(resolve, 1300));
			assert.strictEqual(fs.existsSync(path.join(directory, 'late-write')), false);
			assert.strictEqual(token.listenerCount, 0);
		});
	});

	(process.platform === 'win32' ? test.skip : test)('escalates cancellation when a POSIX descendant ignores SIGTERM', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			let output = '';
			const command = scriptCommand(directory, `
if (process.argv[2] === 'descendant') {
  process.on('SIGTERM', () => {});
  console.log('descendant-ready');
  setTimeout(() => require('node:fs').writeFileSync('late-write', ''), 3000);
} else {
  require('node:child_process').spawn(process.execPath, [__filename, 'descendant'], { stdio: 'inherit' });
}
`);
			await assert.rejects(runPreCompileScript(command, {
				cwd: directory,
				token,
				onOutput: chunk => {
					output += chunk;
					if (output.includes('descendant-ready')) {
						token.cancel();
					}
				},
			}), PreCompileScriptCancelledError);
			await new Promise<void>(resolve => setTimeout(resolve, 3200));
			assert.strictEqual(fs.existsSync(path.join(directory, 'late-write')), false);
			assert.strictEqual(token.listenerCount, 0);
		});
	});

	(process.platform === 'win32' ? test : test.skip)('waits for natural exit if Windows tree termination fails', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			const systemRoot = process.env.SystemRoot;
			let output = '';
			const command = scriptCommand(directory, `
console.log('script-ready');
setTimeout(() => require('node:fs').writeFileSync('finished', ''), 250);
`);
			try {
				// A missing taskkill executable exercises failure without killing any
				// unrelated process or relying on the host's permission settings.
				await assert.rejects(runPreCompileScript(command, {
					cwd: directory,
					token,
					onOutput: chunk => {
						output += chunk;
						if (output.includes('script-ready') && !token.isCancellationRequested) {
							process.env.SystemRoot = directory;
							token.cancel();
							if (systemRoot === undefined) {
								delete process.env.SystemRoot;
							} else {
								process.env.SystemRoot = systemRoot;
							}
						}
					},
				}), (error: Error) => {
					assert.ok(!(error instanceof PreCompileScriptCancelledError));
					assert.match(error.message, /Unable to stop the pre-compile script/);
					return true;
				});
				assert.strictEqual(fs.existsSync(path.join(directory, 'finished')), true);
				assert.ok(output.includes('Waiting for the script to exit.'));
				assert.strictEqual(token.listenerCount, 0);
			} finally {
				if (systemRoot === undefined) {
					delete process.env.SystemRoot;
				} else {
					process.env.SystemRoot = systemRoot;
				}
			}
		});
	});

	test('reports a process start failure and releases the cancellation listener', async () => {
		await withFixture(async directory => {
			const token = new TestCancellationToken();
			await assert.rejects(runPreCompileScript('echo unused', {
				cwd: path.join(directory, 'missing-directory'), token, onOutput: () => {},
			}), /Pre-compile script failed/);
			assert.strictEqual(token.listenerCount, 0);
		});
	});
});
