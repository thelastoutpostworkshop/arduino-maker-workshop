import { AnsiUp } from 'ansi_up';
import * as vscode from 'vscode';

interface PendingMessage {
	command: string;
	payload?: any;
}

type StatusState = 'success' | 'failure' | 'canceled' | 'info' | '';

export class CliOutputView implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'arduinoMakerWorkshop.compileOutput';

	private view: vscode.WebviewView | undefined;
	private readonly ansi = new AnsiUp();
	private pendingMessages: PendingMessage[] = [];
	private isReady = false;
	private currentTitle = 'Arduino CLI Output';
	private bufferedHtml = '';
	private lastCommandText = '';
	private lastStatusPayload: { state: StatusState, text: string } | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.ansi.use_classes = false;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this.view = webviewView;
		this.isReady = false;

		webviewView.webview.options = {
			enableScripts: true,
		};
		webviewView.webview.html = this.getHtml();

		webviewView.onDidDispose(() => {
			this.view = undefined;
			this.isReady = false;
		});

		webviewView.webview.onDidReceiveMessage((message) => {
			const command = message?.command;
			if (command === 'ready') {
				this.isReady = true;
				this.flushPendingMessages();
				this.setTitle(this.currentTitle);
			} else if (command === 'requestClear') {
				this.clear();
			}
		});
	}

	public async prepare(title: string, reset: boolean = true): Promise<void> {
		this.currentTitle = title || 'Arduino CLI Output';
		try {
			await vscode.commands.executeCommand('workbench.view.extension.arduinoCliOutput');
			await vscode.commands.executeCommand(`${CliOutputView.viewType}.focus`);
			this.view?.show?.(false);
		} catch {
			// Ignore focus errors; panel might not be available in some VS Code flavors.
		}
		if (reset) {
			this.clear();
		}
		this.setTitle(this.currentTitle);
	}

	public append(chunk: string): void {
		if (!chunk) {
			return;
		}
		const normalized = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const colorized = this.applyInlineHighlighting(normalized);
		const html = this.ansi.ansi_to_html(colorized).replace(/\n/g, '<br/>');
		this.bufferedHtml += html;
		this.postMessage({ command: 'append', payload: html });
	}

	public appendInfo(message: string): void {
		this.append(message);
	}

	public setTitle(title: string): void {
		this.currentTitle = title || 'Arduino CLI Output';
		this.postMessage({ command: 'setTitle', payload: this.currentTitle });
	}

	public setStatus(state: StatusState, text: string = ''): void {
		this.lastStatusPayload = { state, text };
		this.postMessage({ command: 'status', payload: { state, text } });
	}

	public showCommand(command: string, args: string[]): void {
		const cmdLine = `${command} ${args.join(' ')}`.trim();
		this.lastCommandText = cmdLine;
		this.postMessage({
			command: 'showCommand',
			payload: cmdLine,
		});
	}

	public clear(): void {
		this.pendingMessages = this.pendingMessages.filter((msg) => !['append', 'status', 'showCommand'].includes(msg.command));
		this.postMessage({ command: 'clear' });
		this.bufferedHtml = '';
		this.lastCommandText = '';
		this.lastStatusPayload = undefined;
	}

	public dispose(): void {
		this.view = undefined;
		this.pendingMessages = [];
		this.isReady = false;
	}

	private postMessage(message: PendingMessage): void {
		if (this.view && this.isReady) {
			this.view.webview.postMessage(message);
		} else {
			this.pendingMessages.push(message);
		}
	}

	private flushPendingMessages(): void {
		if (!this.view || !this.isReady) {
			return;
		}
		this.view.webview.postMessage({ command: 'clear' });
		this.view.webview.postMessage({ command: 'setTitle', payload: this.currentTitle });
		if (this.lastCommandText) {
			this.view.webview.postMessage({ command: 'showCommand', payload: this.lastCommandText });
		}
		if (this.bufferedHtml) {
			this.view.webview.postMessage({ command: 'append', payload: this.bufferedHtml });
		}
		if (this.lastStatusPayload) {
			this.view.webview.postMessage({ command: 'status', payload: this.lastStatusPayload });
		}
		this.pendingMessages = [];
	}

	private getHtml(): string {
		const nonce = getNonce();
		const stylesUri = this.getStyles();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${stylesUri} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Arduino CLI Output</title>
	<style>
		:root {
			color-scheme: light dark;
		}
		body {
			margin: 0;
			padding: 0;
			font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
			background-color: var(--vscode-panel-background);
			color: var(--vscode-editor-foreground);
			display: flex;
			flex-direction: column;
			height: 100vh;
		}
		#title {
			padding: 8px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			font-weight: 600;
			color: var(--vscode-panelTitle-activeForeground);
			background-color: var(--vscode-panelTitle-activeBorder, transparent);
		}
		#toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 4px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			gap: 8px;
			background-color: var(--vscode-panel-background);
		}
		#search-box {
			flex: 1;
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 4px;
		}
		#filter-input {
			flex: 1;
			min-width: 0;
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			background-color: var(--vscode-input-background, var(--vscode-panel-background));
			color: var(--vscode-input-foreground, inherit);
			padding: 4px 8px;
			font-size: 12px;
		}
		#filter-input:focus {
			border-color: var(--vscode-inputValidation-infoBorder, var(--vscode-panel-border));
			box-shadow: 0 0 0 1px var(--vscode-inputValidation-infoBorder, transparent);
			outline: none;
		}
		#clear-filter {
			border: none;
			background: transparent;
			color: var(--vscode-input-foreground, inherit);
			font-size: 16px;
			line-height: 1;
			cursor: pointer;
			padding: 0 6px;
		}
		#clear-filter:disabled {
			cursor: not-allowed;
			opacity: 0.4;
		}
		#toolbar-actions {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.toolbar-button {
			border-radius: 4px;
			border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
			background: var(--vscode-button-background, transparent);
			color: var(--vscode-button-foreground, var(--vscode-editor-foreground));
			font-size: 12px;
			padding: 4px 10px;
			cursor: pointer;
		}
		.toolbar-button:hover:not(:disabled) {
			background: var(--vscode-button-hoverBackground, rgba(255, 255, 255, 0.1));
		}
		.toolbar-button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		#command {
			font-size: 12px;
			padding: 6px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		#output-wrapper {
			flex: 1;
			overflow-y: auto;
			padding: 8px 12px;
			background-color: var(--vscode-terminal-background, var(--vscode-panel-background));
		}
		#output {
			display: flex;
			flex-direction: column;
			gap: 0;
			font-size: 13px;
			line-height: 1.5;
			word-break: break-word;
		}
		.line {
			white-space: pre-wrap;
		}
		#status {
			padding: 6px 12px;
			border-top: 1px solid var(--vscode-panel-border);
			font-size: 12px;
			min-height: 20px;
		}
		#status.success {
			color: var(--vscode-testing-iconPassed, #89d185);
		}
		#status.failure {
			color: var(--vscode-testing-iconFailed, #f48771);
		}
		#status.canceled {
			color: var(--vscode-descriptionForeground);
		}
		#status.info {
			color: var(--vscode-descriptionForeground);
		}
		.ansi-bold { font-weight: bold; }
	</style>
</head>
<body>
	<div id="title">Arduino CLI Output</div>
	<div id="toolbar">
		<div id="search-box">
			<input id="filter-input" type="search" placeholder="Search output..." spellcheck="false" aria-label="Filter Arduino CLI output">
			<button id="clear-filter" type="button" title="Clear search filter" disabled>&times;</button>
		</div>
		<div id="toolbar-actions">
			<button class="toolbar-button" id="toggle-autoscroll" type="button" aria-pressed="true">Auto-scroll: On</button>
			<button class="toolbar-button" id="clear-output" type="button">Clear Output</button>
		</div>
	</div>
	<div id="command"></div>
	<div id="output-wrapper">
		<div id="output"></div>
	</div>
	<div id="status"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const outputEl = document.getElementById('output');
		const statusEl = document.getElementById('status');
		const titleEl = document.getElementById('title');
		const commandEl = document.getElementById('command');
		const wrapperEl = document.getElementById('output-wrapper');
		const filterInput = document.getElementById('filter-input');
		const clearFilterBtn = document.getElementById('clear-filter');
		const clearOutputBtn = document.getElementById('clear-output');
		const autoScrollBtn = document.getElementById('toggle-autoscroll');

		let filterText = '';
		let autoScrollEnabled = true;

		const updateAutoScrollLabel = () => {
			if (!autoScrollBtn) {
				return;
			}
			autoScrollBtn.textContent = autoScrollEnabled ? 'Auto-scroll: On' : 'Auto-scroll: Off';
			autoScrollBtn.setAttribute('aria-pressed', autoScrollEnabled.toString());
		};

		function applyFilterToLine(lineEl) {
			if (!lineEl) {
				return;
			}
			if (!filterText) {
				lineEl.hidden = false;
				return;
			}
			const candidate = lineEl.dataset.textLower || '';
			lineEl.hidden = !candidate.includes(filterText);
		}

		function applyFilterToAllLines() {
			if (!outputEl) {
				return;
			}
			const lines = outputEl.querySelectorAll('.line');
			lines.forEach(applyFilterToLine);
		}

		function appendChunk(html) {
			if (!html || !outputEl) {
				return;
			}
			const fragment = document.createDocumentFragment();
			const segments = html.split('<br/>');
			segments.forEach((segment) => {
				const lineEl = document.createElement('div');
				lineEl.className = 'line';
				lineEl.innerHTML = segment || '&nbsp;';
				const rawText = lineEl.textContent || '';
				lineEl.dataset.text = rawText;
				lineEl.dataset.textLower = rawText.toLowerCase();
				applyFilterToLine(lineEl);
				fragment.appendChild(lineEl);
			});
			outputEl.appendChild(fragment);
			if (autoScrollEnabled && wrapperEl) {
				wrapperEl.scrollTop = wrapperEl.scrollHeight;
			}
		}

		const refreshFilter = () => {
			filterText = (filterInput?.value || '').trim().toLowerCase();
			if (clearFilterBtn) {
				clearFilterBtn.disabled = !Boolean(filterText);
			}
			applyFilterToAllLines();
		};

		clearOutputBtn?.addEventListener('click', () => {
			vscode.postMessage({ command: 'requestClear' });
		});

		autoScrollBtn?.addEventListener('click', () => {
			autoScrollEnabled = !autoScrollEnabled;
			updateAutoScrollLabel();
			if (autoScrollEnabled && wrapperEl) {
				wrapperEl.scrollTop = wrapperEl.scrollHeight;
			}
		});

		clearFilterBtn?.addEventListener('click', () => {
			if (filterInput) {
				filterInput.value = '';
				refreshFilter();
			}
		});

		filterInput?.addEventListener('input', () => {
			refreshFilter();
		});

		window.addEventListener('message', (event) => {
			const { command, payload } = event.data;
			switch (command) {
				case 'append':
					appendChunk(payload);
					break;
				case 'clear':
					if (outputEl) {
						outputEl.innerHTML = '';
					}
					if (statusEl) {
						statusEl.textContent = '';
						statusEl.className = '';
					}
					if (commandEl) {
						commandEl.textContent = '';
					}
					if (wrapperEl) {
						wrapperEl.scrollTop = 0;
					}
					refreshFilter();
					break;
				case 'setTitle':
					if (titleEl) {
						titleEl.textContent = payload || 'Arduino CLI Output';
					}
					break;
				case 'status':
					if (statusEl) {
						statusEl.textContent = payload?.text || '';
						statusEl.className = payload?.state ? payload.state : '';
					}
					break;
				case 'showCommand':
					if (commandEl) {
						commandEl.textContent = payload || '';
					}
					break;
				default:
					break;
			}
		});

		window.addEventListener('load', () => {
			updateAutoScrollLabel();
			refreshFilter();
			vscode.postMessage({ command: 'ready' });
		});
	</script>
</body>
</html>`;
	}

	private getStyles(): string {
		return "";
	}

	private applyInlineHighlighting(text: string): string {
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim()) {
				continue;
			}
			if (/\u001b\[/.test(line)) {
				continue; // already colorized
			}
			if (this.isErrorLine(line)) {
				lines[i] = this.wrapWithAnsi(line, '\u001b[31m'); // red
			} else if (this.isWarningLine(line)) {
				lines[i] = this.wrapWithAnsi(line, '\u001b[33m'); // yellow
			} else if (this.isNoteLine(line)) {
				lines[i] = this.wrapWithAnsi(line, '\u001b[36m'); // cyan
			}
		}
		return lines.join('\n');
	}

	private isErrorLine(line: string): boolean {
		return /\b(error|undefined reference|fatal error)\b/i.test(line);
	}

	private isWarningLine(line: string): boolean {
		return /\b(warning|deprecated)\b/i.test(line);
	}

	private isNoteLine(line: string): boolean {
		return /\b(note|info)\b/i.test(line);
	}

	private wrapWithAnsi(line: string, colorCode: string): string {
		const resetCode = '\u001b[0m';
		return `${colorCode}${line}${resetCode}`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
