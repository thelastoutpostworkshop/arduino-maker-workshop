import { AiBridgeError, type AiIssue, type OperationProgress, type ProjectInspection } from './contracts';
import type { ProcessResult } from './processRunner';
import { validateLibraryInstall } from './toolInputs';

const MAX_INVENTORY_ENTRIES = 20000;
const MAX_CHANGED_LIBRARIES = 500;
const MAX_INSTALLED_VERSIONS = 100;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;

interface LibraryVersion { name: string; version?: string; }

export interface LibraryInstallationResult {
    schemaVersion: 1;
    status: 'success' | 'failed' | 'canceled';
    outcome: 'installed' | 'already_installed' | 'unverified';
    scope: 'user_libraries';
    target: { sketchPath: string; profile?: string };
    library: string;
    version: string;
    previousVersions: string[];
    installedVersions: string[] | null;
    installedVersionsTruncated?: true;
    changesMayHaveOccurred: boolean;
    changes: { added: LibraryVersion[]; removed: LibraryVersion[]; complete: boolean };
    exitCode: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    durationMs: number;
    error?: AiIssue;
    notes: string[];
}

export interface LibraryInstallationOptions {
    target: ProjectInspection;
    library: string;
    version: string;
    signal: AbortSignal;
    progress(value: OperationProgress): void;
    assertCurrent(): void;
    query(args: string[], signal: AbortSignal): Promise<unknown>;
    run(args: string[], signal: AbortSignal): Promise<ProcessResult>;
    onMutationStarted?(): void;
}

function invalidOutput(): never {
    throw new AiBridgeError('INVALID_CLI_OUTPUT', 'Arduino CLI returned invalid or oversized library metadata.');
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return invalidOutput(); }
    return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length > MAX_INVENTORY_ENTRIES) { return invalidOutput(); }
    return value;
}

function text(value: unknown, maximum = 512): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) { return invalidOutput(); }
    return value;
}

function completeMetadata(value: unknown): Record<string, unknown> {
    const data = record(value);
    if (data.warnings !== undefined) {
        const warnings = list(data.warnings);
        warnings.forEach(warning => text(warning, 8192));
        if (warnings.length) {
            throw new AiBridgeError('LIBRARY_METADATA_INCOMPLETE', 'Arduino CLI reported warnings. Resolve its library metadata issues before installing.');
        }
    }
    return data;
}

/** Arduino normalizes omitted numeric components but preserves build metadata. */
function releaseIdentity(version: string): string {
    const parsed = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
    if (!parsed || parsed[4]?.slice(1).split('.').some(identifier => /^0\d+$/.test(identifier))) { return version; }
    return `${parsed[1]}.${parsed[2] ?? '0'}.${parsed[3] ?? '0'}${parsed[4] ?? ''}${parsed[5] ?? ''}`;
}

function profileNotes(target: ProjectInspection, library: string, version: string): string[] {
    if (target.declaredDependencies.issues.length || target.issues.some(issue => [
        'INVALID_YAML', 'INVALID_PROFILES', 'PROFILE_REQUIRED', 'PROFILE_NOT_FOUND', 'INVALID_PROFILE',
        'INVALID_METADATA', 'METADATA_UNREADABLE', 'INVALID_CONFIGURATION',
    ].includes(issue.code))) {
        throw new AiBridgeError('INVALID_PROFILE', 'Resolve the project profile and dependency declarations before installing a library.');
    }
    if (!target.resolvedProfile) { return []; }
    const declarations = target.declaredDependencies.libraries.filter(dependency => dependency.kind === 'index' && dependency.name === library);
    if (!declarations.length) {
        throw new AiBridgeError('PROFILE_LIBRARY_NOT_DECLARED', 'The selected profile does not declare this indexed library. Its dependency declarations are not changed by installation.');
    }
    if (declarations.some(dependency => dependency.kind === 'index' && dependency.version !== undefined && releaseIdentity(dependency.version) !== releaseIdentity(version))) {
        throw new AiBridgeError('PROFILE_VERSION_CONFLICT', 'The requested version conflicts with the selected profile dependency declaration. Request its declared version or edit the profile first.');
    }
    return [
        'This installs the standard user library only. The selected profile uses isolated dependencies; its declarations and dependency cache are unchanged. Compile the profile to prepare its own dependencies.',
        ...(declarations.some(dependency => dependency.kind === 'index' && dependency.version === undefined)
            ? ['The profile does not pin this library version. Its compilation may select a different version; this installation does not add a version pin.'] : []),
    ];
}

function userInventory(value: unknown): LibraryVersion[] {
    const data = completeMetadata(value);
    const result: LibraryVersion[] = [];
    for (const entry of list(data.installed_libraries)) {
        const library = record(record(entry).library);
        const name = text(library.name);
        const location = text(library.location, 128);
        if (!['user', 'ide', 'platform', 'ref-platform', 'unmanaged', 'profile'].includes(location)) { return invalidOutput(); }
        const version = library.version === undefined || library.version === '' ? undefined : text(library.version, 128);
        if (location === 'user') { result.push({ name, ...(version ? { version } : {}) }); }
    }
    return result;
}

function matchingLibraries(inventory: LibraryVersion[], name: string): LibraryVersion[] {
    return inventory.filter(library => library.name === name);
}

function versions(inventory: LibraryVersion[], name: string): string[] {
    return [...new Set(matchingLibraries(inventory, name).flatMap(library => library.version === undefined ? [] : [library.version]))].sort();
}

function verifyIndexedRelease(value: unknown, library: string, version: string): void {
    const data = completeMetadata(value);
    if (data.status !== 'success' && data.status !== 'failed') { return invalidOutput(); }
    const matches = (data.libraries === undefined ? [] : list(data.libraries)).map(record).filter(entry => text(entry.name) === library);
    if (data.status === 'failed' || matches.length === 0) {
        throw new AiBridgeError('LIBRARY_NOT_FOUND', 'The exact library name was not found in the Arduino library index. Search for its indexed name first.');
    }
    if (matches.length !== 1) { return invalidOutput(); }
    const available = list(matches[0].available_versions).map(value => text(value, 128));
    if (!available.some(availableVersion => releaseIdentity(availableVersion) === releaseIdentity(version))) {
        throw new AiBridgeError('LIBRARY_VERSION_NOT_FOUND', 'The requested library version is not available in the Arduino library index. Search for an available version first.');
    }
}

function changes(before: LibraryVersion[], after: LibraryVersion[]): LibraryInstallationResult['changes'] {
    const identity = (library: LibraryVersion) => JSON.stringify([library.name, library.version ?? null]);
    const oldVersions = new Map(before.map(library => [identity(library), library]));
    const newVersions = new Map(after.map(library => [identity(library), library]));
    const added = [...newVersions].filter(([key]) => !oldVersions.has(key)).map(([, library]) => library);
    const removed = [...oldVersions].filter(([key]) => !newVersions.has(key)).map(([, library]) => library);
    return {
        added: added.slice(0, MAX_CHANGED_LIBRARIES), removed: removed.slice(0, MAX_CHANGED_LIBRARIES),
        complete: added.length <= MAX_CHANGED_LIBRARIES && removed.length <= MAX_CHANGED_LIBRARIES,
    };
}

function boundedText(value: string): { value: string; truncated: boolean } {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length <= MAX_OUTPUT_BYTES) { return { value, truncated: false }; }
    let start = bytes.length - MAX_OUTPUT_BYTES;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) { start++; }
    return { value: bytes.subarray(start).toString('utf8'), truncated: true };
}

function boundedResult(result: LibraryInstallationResult): LibraryInstallationResult {
    // Changes are supplemental; retain the requested package and mutation outcome.
    while (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_REPORT_BYTES) {
        result.truncated = true;
        result.changes.complete = false;
        if (result.changes.added.length >= result.changes.removed.length && result.changes.added.length) {
            result.changes.added.length = Math.floor(result.changes.added.length / 2);
        } else if (result.changes.removed.length) { result.changes.removed.length = Math.floor(result.changes.removed.length / 2); }
        else if (result.stdout.length || result.stderr.length) {
            if (result.stdout.length >= result.stderr.length) { result.stdout = result.stdout.slice(Math.ceil(result.stdout.length / 2)); }
            else { result.stderr = result.stderr.slice(Math.ceil(result.stderr.length / 2)); }
        } else {
            // Only fixed fields and validated bounded inputs remain at this point.
            result.error = { code: 'LIBRARY_RESULT_LIMIT', message: 'The installation result exceeded its output limit. Libraries may have changed.' };
            result.notes = [];
            break;
        }
    }
    return result;
}

function failure(error: unknown, fallback: string): AiIssue {
    // Unexpected exceptions can contain raw machine data; only known errors cross the bridge.
    return error instanceof AiBridgeError ? { code: error.code.slice(0, 128), message: error.message.slice(0, 2048) }
        : { code: fallback, message: 'Library installation could not be completed or verified. Inspect Arduino CLI Output for details.' };
}

/** Install one exact indexed release in the shared user scope, with no project edits. */
export async function installLibraryForTarget(options: LibraryInstallationOptions): Promise<LibraryInstallationResult> {
    const started = Date.now();
    const { library, version } = validateLibraryInstall(options.library, options.version);
    const notes = [
        'User libraries are shared by sketches using this Arduino CLI configuration. An explicitly requested version can replace the installed version.',
        'Arduino CLI may install required library dependencies. Existing sketches may need recompilation after library changes.',
        ...profileNotes(options.target, library, version),
    ];
    const guard = () => {
        if (options.signal.aborted) { throw new AiBridgeError('CANCELED', 'Library installation was canceled.'); }
        options.assertCurrent();
    };
    const query = async (args: string[]) => {
        guard();
        const value = await options.query(args, options.signal);
        guard();
        return value;
    };
    guard();
    options.progress({ message: `Checking installed versions of ${library}...` });
    const before = userInventory(await query(['lib', 'list', '--all', '--json']));
    const previous = matchingLibraries(before, library);
    if (previous.length > 1 || previous.some(item => item.version === undefined)) {
        throw new AiBridgeError('LIBRARY_INSTALLATION_AMBIGUOUS', 'The user library inventory has duplicate or unversioned copies of this library. Resolve them in Library Manager before installing.');
    }
    const result: LibraryInstallationResult = {
        schemaVersion: 1, status: 'success', outcome: 'already_installed', scope: 'user_libraries',
        target: { sketchPath: options.target.sketchPath, ...(options.target.resolvedProfile ? { profile: options.target.resolvedProfile } : {}) },
        library, version, previousVersions: versions(before, library), installedVersions: versions(before, library),
        changesMayHaveOccurred: false, changes: { added: [], removed: [], complete: true },
        exitCode: null, stdout: '', stderr: '', truncated: false, durationMs: Date.now() - started, notes,
    };
    if (previous.length === 1 && releaseIdentity(previous[0].version!) === releaseIdentity(version)) {
        options.progress({ message: `${library} ${version} is already installed in user libraries.` });
        return result;
    }
    options.progress({ message: `Checking ${library} ${version} in the library index...` });
    verifyIndexedRelease(await query(['lib', 'search', '--omit-releases-details', '--json', '--', library]), library, version);
    guard();
    options.progress({ message: `Installing ${library} ${version} in user libraries...` });
    options.onMutationStarted?.();
    guard();
    result.outcome = 'unverified';
    result.changesMayHaveOccurred = true;
    result.installedVersions = null;
    result.changes.complete = false;
    result.notes.push('Installation is not transactional. Failed or canceled installations may leave changed libraries or downloaded files; no automatic retry or rollback is performed.');
    try {
        const process = await options.run(['lib', 'install', '--', `${library}@${version}`], options.signal);
        const stdout = boundedText(process.stdout);
        const stderr = boundedText(process.stderr);
        result.stdout = stdout.value;
        result.stderr = stderr.value;
        result.truncated = process.truncated || stdout.truncated || stderr.truncated;
        result.exitCode = process.exitCode;
        if (process.canceled || options.signal.aborted) {
            result.status = 'canceled';
            result.error = { code: 'CANCELED', message: 'Library installation was canceled. Libraries may have changed before cancellation.' };
        } else if (process.error || process.exitCode !== 0) {
            result.status = 'failed';
            result.error = process.error ? { code: process.error.code.slice(0, 128), message: process.error.message.slice(0, 2048) }
                : { code: 'LIBRARY_INSTALL_FAILED', message: `Arduino CLI library installation exited with code ${process.exitCode}.` };
        }
    } catch (error) {
        result.status = options.signal.aborted || error instanceof AiBridgeError && error.code === 'CANCELED' ? 'canceled' : 'failed';
        result.error = failure(error, 'LIBRARY_INSTALL_FAILED');
    }
    try {
        guard();
        options.progress({ message: 'Verifying the installed user libraries...' });
        const after = userInventory(await query(['lib', 'list', '--all', '--json']));
        result.installedVersions = versions(after, library);
        if (result.installedVersions.length > MAX_INSTALLED_VERSIONS) {
            result.installedVersions = result.installedVersions.slice(0, MAX_INSTALLED_VERSIONS);
            result.installedVersionsTruncated = true;
            result.truncated = true;
        }
        result.changes = changes(before, after);
        const installed = matchingLibraries(after, library);
        const verified = installed.length === 1 && installed[0].version !== undefined && releaseIdentity(installed[0].version) === releaseIdentity(version);
        if (result.status === 'success') {
            if (verified) { result.outcome = 'installed'; }
            else {
                result.status = 'failed';
                result.error = { code: 'LIBRARY_INSTALL_NOT_VERIFIED', message: 'Arduino CLI finished, but the exact requested user library version could not be verified.' };
            }
        }
    } catch (error) {
        const issue = failure(error, 'LIBRARY_INSTALL_NOT_VERIFIED');
        if (result.status === 'success') {
            result.status = options.signal.aborted || issue.code === 'CANCELED' ? 'canceled' : 'failed';
            result.error = issue;
        }
        result.notes.push('The final user library inventory could not be verified. Check installed dependencies before deciding whether to retry.');
    }
    result.durationMs = Date.now() - started;
    return boundedResult(result);
}
