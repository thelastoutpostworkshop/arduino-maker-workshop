import type { OperationStatus } from './contracts';

export interface CompileUsedLibrary {
    name: string;
    version?: string;
    path?: string;
}

export interface CompileUsedPlatform {
    id: string;
    version?: string;
    path?: string;
}

export interface CompileDependenciesReport {
    status: 'available' | 'partial' | 'unavailable';
    libraries: CompileUsedLibrary[];
    platforms: CompileUsedPlatform[];
    notes: string[];
}

interface TableState {
    kind: 'libraries' | 'platforms';
    versionColumn: number;
    pathColumn: number;
}

const MAX_LIBRARIES = 100;
const MAX_PLATFORMS = 20;
const MAX_NAME_BYTES = 512;
const MAX_VERSION_BYTES = 128;
const MAX_PATH_BYTES = 4096;
const MAX_LINE_BYTES = 16 * 1024;
const MAX_REPORT_BYTES = 192 * 1024;

function boundedNote(value: string): string {
    const bytes = Buffer.from(value);
    if (bytes.length <= 2048) { return value; }
    let end = 2045;
    while ((bytes[end] & 0xc0) === 0x80) { end--; }
    return bytes.subarray(0, end).toString('utf8') + '...';
}

export function unavailableCompileDependencies(reason: string): CompileDependenciesReport {
    return { status: 'unavailable', libraries: [], platforms: [], notes: [boundedNote(reason)] };
}

/**
 * Reads only Arduino CLI's resolved dependency output, not discovery commands,
 * installed-package inventories, compiler command arguments, or folder names.
 * The caller supplies complete, already-redacted, ANSI-stripped output lines.
 */
export class CompileDependenciesCollector {
    private readonly libraries: CompileUsedLibrary[] = [];
    private readonly platforms: CompileUsedPlatform[] = [];
    private readonly tables: Partial<Record<'stdout' | 'stderr', TableState>> = {};
    private reportBytes = 0;
    private limited = false;
    private malformedTable = false;
    private conflicting = false;
    private result?: CompileDependenciesReport;

    public line(text: string, stream: 'stdout' | 'stderr'): void {
        if (this.result) { return; }
        if (Buffer.byteLength(text) > MAX_LINE_BYTES || /[\n\u0000]/.test(text)) {
            this.limited = true;
            delete this.tables[stream];
            return;
        }
        const line = text.replace(/\r$/, '').trimStart();
        if (!line.trim()) {
            delete this.tables[stream];
            return;
        }
        const header = /^(Used library|Used platform)( +)Version( +)Path\s*$/.exec(line);
        if (header) {
            this.tables[stream] = {
                kind: header[1] === 'Used library' ? 'libraries' : 'platforms',
                versionColumn: header[1].length + header[2].length,
                pathColumn: header[1].length + header[2].length + 'Version'.length + header[3].length,
            };
            return;
        }
        const verboseLibrary = this.parseVerboseLibrary(line);
        if (verboseLibrary) {
            delete this.tables[stream];
            this.addLibrary(verboseLibrary);
            return;
        }
        const table = this.tables[stream];
        if (!table) { return; }
        // Arduino CLI pads cells by Unicode rune count, not UTF-16 code units.
        const columns = Array.from(line);
        const name = columns.slice(0, table.versionColumn).join('').trimEnd();
        const version = columns.slice(table.versionColumn, table.pathColumn).join('').trim();
        const path = columns.slice(table.pathColumn).join('').trim();
        if (!name || !this.isAbsolutePath(path) || /[\u0000-\u001f]/.test(name + version + path)
            || table.kind === 'platforms' && !/^[\w.-]+:[\w.-]+$/.test(name)) {
            this.malformedTable = true;
            delete this.tables[stream];
            return;
        }
        if (table.kind === 'libraries') {
            this.addLibrary({ name, ...(version ? { version } : {}), path });
        } else {
            this.addPlatform({ id: name, ...(version ? { version } : {}), path });
        }
    }

    public finish(input: { status: OperationStatus; truncated: boolean; incomplete: boolean }): CompileDependenciesReport {
        if (this.result) { return this.result; }
        const notes = ['Only dependency usage recognized in this compiler invocation is included; installed or declared dependencies are not substituted.'];
        let partial = false;
        if (!this.libraries.length) {
            partial = true;
            notes.push('No supported library usage was reported. An empty list does not establish that the sketch uses no libraries.');
        }
        if (!this.platforms.length) {
            partial = true;
            notes.push('No supported platform usage was reported; package IDs and versions are not inferred from folder names.');
        }
        if (this.libraries.some(item => !item.version || !item.path) || this.platforms.some(item => !item.version || !item.path)) {
            partial = true;
            notes.push('Some used dependencies have no reported version or installation path.');
        }
        if (input.truncated || input.incomplete) {
            partial = true;
            notes.push('Compiler output was truncated or omitted; recognized live usage was collected separately and may be incomplete.');
        }
        if (input.status !== 'success') {
            partial = true;
            notes.push('Compilation did not succeed; these entries describe only the dependency usage reported before it stopped.');
        }
        if (this.limited) {
            partial = true;
            notes.push('Dependency output exceeded limits: 100 libraries, 20 platforms, 512-byte names, 128-byte versions, 4096-byte paths, 16 KiB lines, or 192 KiB of entry text. Oversized entries were omitted.');
        }
        if (this.malformedTable) {
            partial = true;
            notes.push('Some dependency table rows could not be read in the supported output format.');
        }
        if (this.conflicting) {
            partial = true;
            notes.push('The compiler reported the same dependency name or platform ID with different versions or paths; the distinct entries are preserved.');
        }
        if (!this.libraries.length && !this.platforms.length) {
            notes.push('Successful compilation with Verbose Compile disabled, another output language, or an early failure may omit dependency usage.');
        }
        this.result = {
            status: !this.libraries.length && !this.platforms.length ? 'unavailable' : partial ? 'partial' : 'available',
            libraries: this.libraries,
            platforms: this.platforms,
            notes,
        };
        return this.result;
    }

    private parseVerboseLibrary(line: string): CompileUsedLibrary | undefined {
        const versioned = /^Using library (.+?) at version (.+?) in folder: (.+)$/.exec(line)
            ?? /^Utilisation de la biblioth\u00e8que (.+?) version (.+?) dans le dossier: (.+)$/.exec(line);
        const unversioned = versioned ? null : /^Using library (.+?) in folder: (.+)$/.exec(line)
            ?? /^Utilisation de la biblioth\u00e8que (.+?) prise dans le dossier: (.+)$/.exec(line);
        const match = versioned ?? unversioned;
        if (!match) { return undefined; }
        // CLI leaves a trailing separator when the legacy marker is empty.
        // Preserve it until after marker detection: a modern library directory
        // may itself end in " (legacy)". Versioned libraries are never legacy.
        const folder = versioned ? match[3] : match[2].replace(/ \((?:legacy|h\u00e9ritage)\)$/, '');
        const path = folder.trim();
        if (!this.isAbsolutePath(path) || /[\u0000-\u001f]/.test(match[1] + (versioned ? match[2] : '') + path)) { return undefined; }
        return { name: match[1], ...(versioned ? { version: match[2] } : {}), path };
    }

    private isAbsolutePath(value: string): boolean {
        return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/)/.test(value);
    }

    private addLibrary(value: CompileUsedLibrary): void { this.add(this.libraries, value, 'name', MAX_LIBRARIES); }
    private addPlatform(value: CompileUsedPlatform): void { this.add(this.platforms, value, 'id', MAX_PLATFORMS); }

    private add<T extends { version?: string; path?: string }>(entries: T[], value: T, nameKey: keyof T, limit: number): void {
        const name = String(value[nameKey]);
        const versionBytes = Buffer.byteLength(value.version ?? '');
        const entryBytes = Buffer.byteLength(name) + versionBytes + Buffer.byteLength(value.path ?? '');
        if (Buffer.byteLength(name) > MAX_NAME_BYTES || versionBytes > MAX_VERSION_BYTES
            || Buffer.byteLength(value.path ?? '') > MAX_PATH_BYTES) {
            this.limited = true;
            return;
        }
        for (const existing of entries) {
            if (existing[nameKey] !== value[nameKey]) { continue; }
            if (existing.path === value.path && (existing.version === value.version || !existing.version || !value.version)) {
                if (!existing.version && value.version) {
                    if (this.reportBytes + versionBytes > MAX_REPORT_BYTES) { this.limited = true; return; }
                    existing.version = value.version;
                    this.reportBytes += versionBytes;
                }
                return;
            }
        }
        if (entries.length >= limit || this.reportBytes + entryBytes > MAX_REPORT_BYTES) {
            this.limited = true;
            return;
        }
        if (entries.some(existing => existing[nameKey] === value[nameKey])) { this.conflicting = true; }
        entries.push(value);
        this.reportBytes += entryBytes;
    }
}
