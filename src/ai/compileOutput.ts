import * as path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

export type CompileReportStatus = 'available' | 'partial' | 'unavailable';

export interface CompileDiagnostic {
    severity: 'error' | 'warning' | 'note';
    message: string;
    file?: string;
    line?: number;
    column?: number;
    code?: string;
}

export interface CompileDiagnostics {
    status: CompileReportStatus;
    items: CompileDiagnostic[];
    notes: string[];
}

export interface CompileMemoryRegion {
    usedBytes: number;
    maxBytes?: number;
    percent?: number;
}

export interface CompileMemory {
    status: CompileReportStatus;
    flash?: CompileMemoryRegion;
    ram?: CompileMemoryRegion;
    notes: string[];
}

export interface CompileOutputReport {
    diagnostics: CompileDiagnostics;
    memory: CompileMemory;
}

interface StreamFrame {
    pending: string;
    bytes: number;
    dropping: boolean;
}

const MAX_LINE_BYTES = 16 * 1024;
const MAX_DIAGNOSTICS = 100;
const MAX_MESSAGE_BYTES = 2048;
const MAX_FILE_BYTES = 4096;
const MAX_CODE_BYTES = 128;

function boundedText(text: string, bytes: number): string {
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.length <= bytes) { return text; }
    let end = bytes - 3;
    while (end > 0 && (buffer[end] & 0xc0) === 0x80) { end--; }
    return buffer.subarray(0, end).toString('utf8') + '...';
}

export function unavailableCompileOutput(reason: string): CompileOutputReport {
    const note = boundedText(reason, MAX_MESSAGE_BYTES);
    return {
        diagnostics: { status: 'unavailable', items: [], notes: [note] },
        memory: { status: 'unavailable', notes: [note] },
    };
}

/**
 * Parses already-redacted live output, independently of the retained log tail.
 * Only known line formats are interpreted. Compiler exit status remains the
 * authority for build success; an empty list never establishes error-free output.
 */
export class CompileOutputCollector {
    private readonly out: StreamFrame = { pending: '', bytes: 0, dropping: false };
    private readonly err: StreamFrame = { pending: '', bytes: 0, dropping: false };
    private readonly items: CompileDiagnostic[] = [];
    private flash?: CompileMemoryRegion;
    private ram?: CompileMemoryRegion;
    private boundedLines = false;
    private boundedDiagnostics = false;
    private conflictingMemory = false;
    private result?: CompileOutputReport;

    public constructor(private readonly sketchPath: string) {}

    public stdout(text: string): void { this.consume(this.out, text); }
    public stderr(text: string): void { this.consume(this.err, text); }

    public finish(input: {
        status: 'success' | 'failed' | 'canceled' | 'busy' | 'invalid';
        truncated: boolean;
    }): CompileOutputReport {
        if (this.result) { return this.result; }
        for (const stream of [this.out, this.err]) {
            if (stream.pending && !stream.dropping) { this.parseLine(stream.pending); }
            stream.pending = '';
            stream.bytes = 0;
        }
        const sharedNotes: string[] = [];
        if (input.truncated) {
            sharedNotes.push('Raw compiler output was truncated; recognized live output was collected separately and the report may be incomplete.');
        }
        if (this.boundedLines) {
            sharedNotes.push('Oversized compiler output lines were omitted from structured parsing.');
        }
        if (input.status === 'canceled' || input.status === 'busy' || input.status === 'invalid') {
            sharedNotes.push('Compilation did not finish; the report may be incomplete.');
        }
        const diagnosticsNotes = [
            'Only recognized GCC, Clang, linker, and Arduino CLI diagnostic lines are included. Raw compiler output may contain additional details.',
            ...sharedNotes,
        ];
        if (this.boundedDiagnostics) {
            diagnosticsNotes.push('Diagnostics were limited to 100 entries, 2048 bytes per message, 4096 bytes per file path, and 128 bytes per warning code.');
        }
        if (!this.items.length) {
            diagnosticsNotes.push('No supported diagnostic lines were recognized. An empty list does not establish that the compiler emitted no errors or warnings.');
        }
        const memoryNotes = [...sharedNotes];
        const hasMemory = Boolean(this.flash || this.ram);
        if (!hasMemory) {
            memoryNotes.push('No supported memory summary was recognized. This board, output format, language, or unfinished build may not provide one.');
        } else if (!this.flash || !this.ram) {
            memoryNotes.push(`The compiler did not report a supported ${this.flash ? 'RAM' : 'flash'} summary.`);
        }
        if (this.conflictingMemory) {
            memoryNotes.push('Multiple different memory summaries were reported; the last recognized summary for each region is shown.');
        }
        this.result = {
            diagnostics: {
                status: !this.items.length ? 'unavailable' : sharedNotes.length || this.boundedDiagnostics ? 'partial' : 'available',
                items: this.items,
                notes: diagnosticsNotes,
            },
            memory: {
                status: !hasMemory ? 'unavailable' : sharedNotes.length || this.conflictingMemory || !this.flash || !this.ram ? 'partial' : 'available',
                ...(this.flash ? { flash: this.flash } : {}),
                ...(this.ram ? { ram: this.ram } : {}),
                notes: memoryNotes,
            },
        };
        return this.result;
    }

    private consume(stream: StreamFrame, text: string): void {
        if (this.result) { return; }
        let start = 0;
        while (start < text.length) {
            const newline = text.indexOf('\n', start);
            const end = newline < 0 ? text.length : newline;
            if (!stream.dropping) {
                const piece = text.slice(start, end);
                const bytes = Buffer.byteLength(piece, 'utf8');
                if (stream.bytes + bytes > MAX_LINE_BYTES) {
                    stream.pending = '';
                    stream.bytes = 0;
                    stream.dropping = true;
                    this.boundedLines = true;
                } else {
                    stream.pending += piece;
                    stream.bytes += bytes;
                }
            }
            if (newline < 0) { return; }
            if (!stream.dropping) { this.parseLine(stream.pending); }
            stream.pending = '';
            stream.bytes = 0;
            stream.dropping = false;
            start = newline + 1;
        }
    }

    private parseLine(raw: string): void {
        const text = stripVTControlCharacters(raw).trim();
        if (!text) { return; }
        this.parseMemory(text);
        const diagnostic = this.parseDiagnostic(text);
        if (!diagnostic) { return; }
        if (this.items.length >= MAX_DIAGNOSTICS) {
            this.boundedDiagnostics = true;
            return;
        }
        for (const [key, limit] of [['message', MAX_MESSAGE_BYTES], ['file', MAX_FILE_BYTES], ['code', MAX_CODE_BYTES]] as const) {
            const value = diagnostic[key];
            if (value && Buffer.byteLength(value, 'utf8') > limit) {
                diagnostic[key] = boundedText(value, limit);
                this.boundedDiagnostics = true;
            }
        }
        this.items.push(diagnostic);
    }

    private parseDiagnostic(text: string): CompileDiagnostic | undefined {
        const located = /^(.*?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.+)$/i.exec(text);
        const locatedReference = located ? null : /^(.*?):(\d+)(?::(\d+))?:\s*((?:undefined reference to|multiple definition of)\s+.+)$/i.exec(text);
        const location = located ?? locatedReference;
        let message: string;
        let diagnostic: CompileDiagnostic;
        if (location) {
            const line = Number(location[2]);
            const column = location[3] === undefined ? undefined : Number(location[3]);
            if (!Number.isSafeInteger(line) || (column !== undefined && !Number.isSafeInteger(column))) { return; }
            const file = location[1].trim();
            if (!file) { return; }
            diagnostic = {
                severity: located ? this.severity(located[4]) : 'error',
                file: this.resolveFile(file), line,
                ...(column === undefined ? {} : { column }),
                message: '',
            };
            message = located ? located[5] : location[4];
        } else {
            const plain = /^(?:(?:[a-z]:)?[^:\r\n]*:\s*)?(fatal error|error|warning|note):\s*(.+)$/i.exec(text);
            const cli = /^(?:Error during build|Compilation error):\s*(.+)$/i.exec(text);
            // Linkers often omit an explicit "error:" severity prefix.
            const linker = /^(?:.*[/\\])?(?:[\w.+-]*-)?(?:ld(?:\.bfd|\.gold)?|lld)(?:\.exe)?:\s*(.+)$/i.exec(text);
            const reference = /^.+?:\s*((?:undefined reference to|multiple definition of)\s+.+)$/i.exec(text);
            if (plain) {
                diagnostic = { severity: this.severity(plain[1]), message: '' };
                message = plain[2];
            } else if (cli || reference || linker && /(?:cannot find|cannot open|undefined reference|multiple definition|overflowed by|will not fit|unrecognized|syntax error)/i.test(linker[1])) {
                diagnostic = { severity: 'error', message: '' };
                message = (cli ?? reference ?? linker)![1];
            } else {
                return;
            }
        }
        const code = /\s+\[(-W[^\]\r\n]+)\]$/.exec(message);
        if (code) {
            diagnostic.code = code[1];
            message = message.slice(0, code.index);
        }
        diagnostic.message = message.trim();
        return diagnostic;
    }

    private severity(value: string): CompileDiagnostic['severity'] {
        const lowered = value.toLowerCase();
        return lowered === 'warning' || lowered === 'note' ? lowered : 'error';
    }

    private resolveFile(file: string): string {
        if (/^<[^>]+>$/.test(file)) { return file; }
        if (path.win32.isAbsolute(file) || path.posix.isAbsolute(file)) { return file; }
        const paths = path.win32.isAbsolute(this.sketchPath) && !path.posix.isAbsolute(this.sketchPath) ? path.win32 : path.posix;
        return paths.resolve(this.sketchPath, file);
    }

    private parseMemory(text: string): void {
        // Standard Arduino CLI sizer templates, including its French translation.
        // Platform-specific advanced sizer output has no common schema.
        const flash = /^Sketch uses (\d+) bytes \((\d+)%\) of program storage space\. Maximum is (\d+) bytes\.$/.exec(text)
            ?? /^Le croquis utilise (\d+) octets \((\d+)%\) de l'espace de stockage de programmes\. Le maximum est de (\d+) octets\.$/.exec(text);
        const ram = /^Global variables use (\d+) bytes \((\d+)%\) of dynamic memory, leaving -?\d+ bytes for local variables\. Maximum is (\d+) bytes\.$/.exec(text)
            ?? /^Les variables globales utilisent (\d+) octets \((\d+)%\) de m\u00e9moire dynamique, ce qui laisse -?\d+ octets pour les variables locales\. Le maximum est de (\d+) octets\.$/.exec(text);
        const ramWithoutMaximum = /^Global variables use (\d+) bytes of dynamic memory\.$/.exec(text)
            ?? /^Les variables globales utilisent (\d+) octets de m\u00e9moire dynamique\.$/.exec(text);
        const match = flash ?? ram ?? ramWithoutMaximum;
        if (!match) { return; }
        const values = match.slice(1).map(Number);
        if (values.some(value => !Number.isSafeInteger(value) || value < 0) || values.length === 3 && values[2] === 0) { return; }
        const value: CompileMemoryRegion = {
            usedBytes: values[0],
            ...(values.length === 3 ? { percent: values[1], maxBytes: values[2] } : {}),
        };
        const region = flash ? 'flash' : 'ram';
        if (this[region] && JSON.stringify(this[region]) !== JSON.stringify(value)) { this.conflictingMemory = true; }
        this[region] = value;
    }
}
