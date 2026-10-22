import * as path from 'node:path';
import { AiBridgeError, AiIssue, ProjectInspection } from './contracts';

const MAX_REPORT_BYTES = 256 * 1024;
const MAX_RAW_ENTRIES = 20000;
const MAX_OPTIONS = 100;
const MAX_OPTION_VALUES = 200;
const MAX_VERSIONS = 200;
const MAX_ARCHITECTURES = 100;

interface DiscoveryReport {
    schemaVersion: 1;
    sketchPath: string;
    sketchName: string;
    profile?: string;
    fqbn?: string;
    complete: boolean;
    truncated: boolean;
    issues: AiIssue[];
}
interface BoardOption {
    id: string;
    label: string;
    defaultValue?: string;
    selectedValue?: string;
    values: { value: string; label: string }[];
    valuesTruncated?: boolean;
}
export interface BoardDetailsReport extends DiscoveryReport {
    scope: 'standard_cli_installations';
    board: { name: string; fqbn: string; version?: string; options: BoardOption[] };
}
interface SearchLibrary {
    name: string;
    latestVersion?: string;
    versions: string[];
    versionsTruncated?: boolean;
    description?: string;
    architectures: string[];
}
export interface LibrarySearchReport extends DiscoveryReport {
    scope: 'library_index';
    query: string;
    total: number;
    returned: number;
    libraries: SearchLibrary[];
    suggestionsOnly?: boolean;
}
export interface ExamplesInput { source?: 'board' | 'libraries' | 'all'; library?: string; limit?: number; }
interface Example {
    name: string;
    path: string;
    source: 'board' | 'libraries';
    library: string;
    platform?: string;
}
export interface ExamplesReport extends DiscoveryReport {
    scope: 'standard_cli_installations';
    source: 'board' | 'libraries' | 'all';
    library?: string;
    total: number;
    returned: number;
    examples: Example[];
}

function invalidOutput(): never {
    throw new AiBridgeError('INVALID_CLI_OUTPUT', 'Arduino CLI returned invalid or oversized discovery data.');
}
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return invalidOutput(); }
    return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length > MAX_RAW_ENTRIES) { return invalidOutput(); }
    return value;
}
function text(value: unknown, required = false, maximum = 512): string | undefined {
    if (value === undefined || value === '') {
        if (required) { return invalidOutput(); }
        return undefined;
    }
    if (typeof value !== 'string' || value.length > maximum || /[\x00-\x1f\x7f]/.test(value) || !value.trim()) {
        return invalidOutput();
    }
    return value;
}
function sortedUnique(values: string[]): string[] { return [...new Set(values)].sort(); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function addIssue(report: DiscoveryReport, code: string, message: string): void {
    if (!report.issues.some(issue => issue.code === code)) { report.issues.push({ code, message }); }
    report.complete = false;
}
function truncated(report: DiscoveryReport): void {
    report.truncated = true;
    addIssue(report, 'DISCOVERY_TRUNCATED', 'Some discovery data was omitted to keep the response within its limits. Narrow the request where possible.');
}
function base(target: ProjectInspection, raw: Record<string, unknown>): DiscoveryReport {
    const report: DiscoveryReport = {
        schemaVersion: 1, sketchPath: target.sketchPath, sketchName: target.sketchName,
        ...(target.resolvedProfile ? { profile: target.resolvedProfile } : {}),
        ...(target.fqbn ? { fqbn: target.fqbn } : {}), complete: true, truncated: false, issues: [],
    };
    if (raw.warnings !== undefined) {
        const warnings = list(raw.warnings);
        warnings.forEach(warning => {
            if (typeof warning !== 'string' || warning.length > 8192) { invalidOutput(); }
        });
        if (warnings.length) {
            addIssue(report, 'CLI_DISCOVERY_INCOMPLETE', 'Arduino CLI reported warnings; discovery results may be incomplete.');
        }
    }
    return report;
}
function bounded<T>(report: DiscoveryReport, values: T[], maximum: number): T[] {
    if (values.length > maximum) { truncated(report); }
    return values.slice(0, maximum);
}
/** Retain a deterministic prefix without emitting a response larger than the IPC budget. */
function boundBytes<T>(report: DiscoveryReport, values: T[], setValues: (values: T[]) => void): void {
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') <= MAX_REPORT_BYTES) { return; }
    truncated(report);
    let lower = 0;
    let upper = values.length;
    while (lower < upper) {
        const middle = Math.ceil((lower + upper) / 2);
        setValues(values.slice(0, middle));
        if (Buffer.byteLength(JSON.stringify(report), 'utf8') <= MAX_REPORT_BYTES) { lower = middle; }
        else { upper = middle - 1; }
    }
    setValues(values.slice(0, lower));
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_REPORT_BYTES) { invalidOutput(); }
}
function requireLimit(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new AiBridgeError('INVALID_ARGUMENT', 'limit must be an integer from 1 to 100.');
    }
    return value;
}

/** The CLI query uses the base FQBN so its selected values describe board defaults. */
export function buildBoardDetails(target: ProjectInspection, raw: unknown): BoardDetailsReport {
    const data = record(raw);
    const fqbn = text(data.fqbn, true, 4096)!;
    const requestedBase = target.fqbn?.split(':').slice(0, 3).join(':');
    if (!requestedBase || fqbn !== requestedBase) { return invalidOutput(); }
    const name = text(data.name, true)!;
    const version = text(data.version, false, 128);
    const report: BoardDetailsReport = {
        ...base(target, data), scope: 'standard_cli_installations',
        board: { name, fqbn, ...(version ? { version } : {}), options: [] },
    };
    const selected = new Map<string, string>();
    for (const pair of target.fqbn!.split(':')[3]?.split(',') ?? []) {
        const separator = pair.indexOf('=');
        if (separator <= 0 || separator === pair.length - 1 || selected.has(pair.slice(0, separator))) {
            addIssue(report, 'BOARD_OPTIONS_UNRESOLVED', 'The selected FQBN contains board options that could not be resolved.');
        } else { selected.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    }
    const optionIds = new Set<string>();
    const options = (data.config_options === undefined ? [] : list(data.config_options)).map((value): BoardOption => {
        const option = record(value);
        const id = text(option.option, true, 128)!;
        if (optionIds.has(id)) { return invalidOutput(); }
        optionIds.add(id);
        const label = text(option.option_label, true)!;
        const valueIds = new Set<string>();
        let defaultValue: string | undefined;
        const values = list(option.values).map(entry => {
            const item = record(entry);
            const id = text(item.value, true, 256)!;
            if (valueIds.has(id) || (item.selected !== undefined && typeof item.selected !== 'boolean')) { return invalidOutput(); }
            valueIds.add(id);
            if (item.selected === true) {
                if (defaultValue !== undefined) { return invalidOutput(); }
                defaultValue = id;
            }
            return { value: id, label: text(item.value_label, true)! };
        }).sort((left, right) => compare(left.value, right.value));
        if (!values.length) { return invalidOutput(); }
        const requested = selected.get(id);
        const selectedValue = requested === undefined ? defaultValue : valueIds.has(requested) ? requested : undefined;
        if (defaultValue === undefined || selectedValue === undefined) {
            addIssue(report, 'BOARD_OPTIONS_UNRESOLVED', 'Some selected board options or defaults could not be resolved from the installed board metadata.');
        }
        const kept = bounded(report, values, MAX_OPTION_VALUES);
        // Keep the default and current choice visible even when the option has many values.
        for (const preferred of [defaultValue, selectedValue]) {
            if (!preferred || kept.some(item => item.value === preferred)) { continue; }
            let replacement = kept.length - 1;
            while (replacement >= 0 && (kept[replacement].value === defaultValue || kept[replacement].value === selectedValue)) { replacement--; }
            if (replacement >= 0) { kept[replacement] = values.find(item => item.value === preferred)!; }
        }
        kept.sort((left, right) => compare(left.value, right.value));
        return {
            id, label, ...(defaultValue ? { defaultValue } : {}), ...(selectedValue ? { selectedValue } : {}), values: kept,
            ...(kept.length < values.length ? { valuesTruncated: true } : {}),
        };
    }).sort((left, right) => compare(left.id, right.id));
    if ([...selected.keys()].some(id => !optionIds.has(id))) {
        addIssue(report, 'BOARD_OPTIONS_UNRESOLVED', 'The selected FQBN contains options that are not exposed by the installed board.');
    }
    report.board.options = bounded(report, options, MAX_OPTIONS);
    boundBytes(report, report.board.options, values => { report.board.options = values; });
    return report;
}

export function buildLibrarySearch(target: ProjectInspection, query: string, limit: number, raw: unknown): LibrarySearchReport {
    requireLimit(limit);
    const data = record(raw);
    if (data.status !== 'success' && data.status !== 'failed') { return invalidOutput(); }
    const suggestionsOnly = data.status === 'failed';
    const report: LibrarySearchReport = {
        ...base(target, data), scope: 'library_index', query, total: 0, returned: 0, libraries: [],
        ...(suggestionsOnly ? { suggestionsOnly: true } : {}),
    };
    if (suggestionsOnly) {
        addIssue(report, 'LIBRARY_SEARCH_INCOMPLETE', 'Arduino CLI could not match the request; any returned names are suggestions, not library version inventories.');
    }
    const libraries = (data.libraries === undefined ? [] : list(data.libraries)).map((value): SearchLibrary => {
        const item = record(value);
        const name = text(item.name, true)!;
        const latest = item.latest === undefined ? undefined : record(item.latest);
        if (!suggestionsOnly && !latest) { return invalidOutput(); }
        const latestVersion = latest ? text(latest.version, !suggestionsOnly, 128) : undefined;
        const versions = sortedUnique((suggestionsOnly && item.available_versions === undefined ? [] : list(item.available_versions)).map(value => text(value, true, 128)!));
        let description: string | undefined;
        if (latest?.sentence !== undefined && latest.sentence !== '') {
            if (typeof latest.sentence !== 'string' || latest.sentence.length > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(latest.sentence)) { invalidOutput(); }
            description = latest.sentence.replace(/\s+/g, ' ').trim();
            if (description.length > 1024) { description = description.slice(0, 1024); truncated(report); }
        }
        const architectures = latest?.architectures === undefined ? [] : sortedUnique(list(latest.architectures).map(value => text(value, true, 128)!));
        return {
            name, ...(latestVersion ? { latestVersion } : {}), versions: bounded(report, versions, MAX_VERSIONS),
            ...(versions.length > MAX_VERSIONS ? { versionsTruncated: true } : {}),
            ...(description ? { description } : {}), architectures: bounded(report, architectures, MAX_ARCHITECTURES),
        };
    }).sort((left, right) => compare(left.name, right.name));
    report.total = libraries.length;
    report.libraries = bounded(report, libraries, limit);
    report.returned = report.libraries.length;
    boundBytes(report, report.libraries, values => { report.libraries = values; report.returned = values.length; });
    return report;
}

export function buildExamples(target: ProjectInspection, input: ExamplesInput, raw: unknown): ExamplesReport {
    const limit = requireLimit(input.limit ?? 50);
    const source = input.source ?? 'all';
    const data = record(raw);
    const report: ExamplesReport = {
        ...base(target, data), scope: 'standard_cli_installations', source,
        ...(input.library ? { library: input.library } : {}), total: 0, returned: 0, examples: [],
    };
    const platformId = target.fqbn?.split(':').slice(0, 2).join(':');
    const examples: Example[] = [];
    const seen = new Set<string>();
    for (const value of list(data.installed_libraries)) {
        const library = record(record(value).library);
        const name = text(library.name, true)!;
        const location = text(library.location, true, 128)!;
        const platform = text(library.container_platform, false, 512);
        if (!['user', 'ide', 'platform', 'ref-platform', 'unmanaged', 'profile'].includes(location)) { return invalidOutput(); }
        const librarySource = location === 'platform' || location === 'ref-platform' ? 'board' : 'libraries';
        const paths = library.examples === undefined ? [] : list(library.examples).map(value => text(value, true, 8192)!);
        if (location === 'profile') {
            addIssue(report, 'PROFILE_EXAMPLES_EXCLUDED', 'Examples from isolated profile dependencies are not included in this standard installation report.');
            continue;
        }
        if (source !== 'all' && librarySource !== source) { continue; }
        if (input.library !== undefined && name !== input.library) { continue; }
        if (librarySource === 'board') {
            if (!platform || !platformId) {
                addIssue(report, 'EXAMPLE_ORIGIN_UNRESOLVED', 'Some board examples could not be associated with the selected platform.');
                continue;
            }
            // The CLI identifies containing platforms as package:architecture@version.
            if (location === 'platform' && platform.split('@')[0] !== platformId) { continue; }
        }
        for (const examplePath of paths) {
            const key = JSON.stringify([name, librarySource, platform, examplePath]);
            if (seen.has(key)) { continue; }
            seen.add(key);
            const exampleName = path.posix.basename(examplePath.replace(/\\/g, '/').replace(/\/+$/, ''));
            if (!exampleName) { return invalidOutput(); }
            examples.push({ name: exampleName, path: examplePath, source: librarySource, library: name, ...(platform ? { platform } : {}) });
        }
    }
    examples.sort((left, right) => compare(left.library, right.library) || compare(left.name, right.name) || compare(left.path, right.path));
    report.total = examples.length;
    report.examples = bounded(report, examples, limit);
    report.returned = report.examples.length;
    boundBytes(report, report.examples, values => { report.examples = values; report.returned = values.length; });
    return report;
}
