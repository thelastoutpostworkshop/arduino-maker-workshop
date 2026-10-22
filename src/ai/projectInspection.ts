import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { AiBridgeError, AiIssue, InspectionInput, ProjectInspection, ProjectProfileSummary } from './contracts';
import { inspectDeclaredDependencies } from './profileDependencies';

const DEFAULT_PROFILE = 'default_profile';
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_SOURCE_ENTRIES = 20000;
const MAX_PROFILE_SUMMARIES = 100;
const MAX_PROFILE_SUMMARY_DEPENDENCY_BYTES = 256 * 1024;
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SOURCE_EXTENSIONS = new Set(['.ino', '.pde', '.cpp', '.h', '.hpp', '.hh', '.ipp', '.tpp', '.c', '.cc', '.cxx', '.s']);
const EXCLUDED_DIRECTORIES = new Set(['.git', '.vscode', 'node_modules']);

// Use the same source types for filesystem events and inspection snapshots.
// Character classes keep the watcher as case-insensitive as the source filter.
export const AI_INPUT_GLOB = `**/*.{${[...SOURCE_EXTENSIONS].map(extension =>
    extension.slice(1).replace(/[a-z]/g, letter => `[${letter}${letter.toUpperCase()}]`)
).join(',')},yaml,json}`;

export function isAiSourceFile(filePath: string): boolean {
    return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
type Metadata = Record<string, unknown>;
interface SourceMetadata {
    path: string;
    size: number;
    mtimeMs: number;
}

function isRecord(value: unknown): value is Metadata {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function canonicalDirectory(value: string, label: string): string {
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
        throw new AiBridgeError('INVALID_ARGUMENT', `${label} must be an absolute directory path.`);
    }
    try {
        const canonical = fs.realpathSync.native(value);
        if (!fs.statSync(canonical).isDirectory()) {
            throw new Error('Not a directory');
        }
        return canonical;
    } catch {
        throw new AiBridgeError('INVALID_SKETCH', `${label} must name an existing directory.`);
    }
}

/** Resolve existing ancestors too, so a not-yet-created output cannot escape through a symlink. */
function scopedPath(root: string, candidate: string, label: string, allowRoot = false): string {
    const resolved = path.resolve(candidate);
    if (!isWithin(root, resolved) || (!allowRoot && path.relative(root, resolved) === '')) {
        throw new AiBridgeError('OUT_OF_SCOPE', `${label} must remain inside the active sketch directory.`);
    }
    let ancestor = resolved;
    const missing: string[] = [];
    while (true) {
        try {
            fs.lstatSync(ancestor);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw new AiBridgeError('INVALID_BUILD_PATH', `${label} cannot be resolved safely.`);
            }
            const parent = path.dirname(ancestor);
            if (parent === ancestor) {
                throw new AiBridgeError('OUT_OF_SCOPE', `${label} cannot be resolved inside the active sketch directory.`);
            }
            missing.unshift(path.basename(ancestor));
            ancestor = parent;
        }
    }
    let canonical: string;
    try {
        canonical = path.resolve(fs.realpathSync.native(ancestor), ...missing);
    } catch {
        throw new AiBridgeError('OUT_OF_SCOPE', `${label} contains an unresolved symbolic link.`);
    }
    if (!isWithin(root, canonical) || (!allowRoot && path.relative(root, canonical) === '')) {
        throw new AiBridgeError('OUT_OF_SCOPE', `${label} must remain inside the active sketch directory.`);
    }
    return canonical;
}

function readMetadata(file: string, label: string, issues: AiIssue[]): string | undefined {
    try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) {
            issues.push({ code: 'INVALID_METADATA', message: `${label} must be a regular file smaller than 1 MiB.` });
            return undefined;
        }
        return fs.readFileSync(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            issues.push({ code: 'METADATA_UNREADABLE', message: `${label} cannot be read.` });
        }
        return undefined;
    }
}

function requireOutputDirectory(value: string): void {
    try {
        if (!fs.statSync(value).isDirectory()) {
            throw new AiBridgeError('INVALID_BUILD_PATH', 'Build output must name a directory.');
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            if (error instanceof AiBridgeError) {
                throw error;
            }
            throw new AiBridgeError('INVALID_BUILD_PATH', 'Build output cannot be inspected safely.');
        }
    }
}

function rejectReservedOutput(root: string, output: string): void {
    const components = path.relative(root, output).split(path.sep).map((component) => component.toLowerCase());
    if (components[0] === 'src' || components.some((component) => EXCLUDED_DIRECTORIES.has(component))) {
        throw new AiBridgeError('INVALID_BUILD_PATH', 'Build output cannot use source, version-control, editor, or dependency directories.');
    }
}

/** A bounded metadata scan; never follow linked directories or read source contents. */
function inspectSources(root: string, buildRoot: string, issues: AiIssue[]): SourceMetadata[] | undefined {
    const sources: SourceMetadata[] = [];
    const pending = [root];
    let entriesVisited = 0;
    try {
        while (pending.length > 0) {
            const directory = pending.pop()!;
            const directoryStat = fs.lstatSync(directory);
            if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
                throw new Error('Source directory is not an ordinary directory');
            }
            const canonical = fs.realpathSync.native(directory);
            if (!isWithin(root, canonical) || path.relative(directory, canonical) !== '') {
                throw new Error('Source directory changed scope');
            }
            const entries: fs.Dirent[] = [];
            const handle = fs.opendirSync(directory);
            try {
                let entry: fs.Dirent | null;
                while ((entry = handle.readSync()) !== null) {
                    if (++entriesVisited > MAX_SOURCE_ENTRIES) {
                        throw new Error('Source scan limit reached');
                    }
                    entries.push(entry);
                }
            } finally {
                handle.closeSync();
            }
            entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()) || isWithin(buildRoot, fullPath)) {
                    continue;
                }
                const stat = fs.lstatSync(fullPath);
                if (stat.isSymbolicLink()) {
                    throw new Error('Source links cannot be tracked without following them');
                }
                if (stat.isDirectory()) {
                    pending.push(fullPath);
                } else if (stat.isFile() && isAiSourceFile(entry.name)) {
                    sources.push({ path: path.relative(root, fullPath).split(path.sep).join('/'), size: stat.size, mtimeMs: stat.mtimeMs });
                }
            }
        }
        return sources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    } catch {
        issues.push({ code: 'SOURCE_SCAN_INCOMPLETE', message: 'Source metadata could not be inspected completely within the bounded sketch directory. Check permissions, symbolic links, and project size before compiling.' });
        return undefined;
    }
}

function optionalString(data: Metadata, key: string, label: string, issues: AiIssue[]): string | undefined {
    const value = data[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || /[\0\r\n]/.test(value)) {
        issues.push({ code: 'INVALID_CONFIGURATION', message: `${label} must be a single-line string.` });
        return undefined;
    }
    return value.trim() || undefined;
}

function optionalBoolean(data: Metadata, key: string, issues: AiIssue[]): boolean {
    const value = data[key];
    if (value !== undefined && typeof value !== 'boolean') {
        issues.push({ code: 'INVALID_CONFIGURATION', message: `${key} must be a boolean.` });
    }
    return value === true;
}

function validFqbn(value: string): boolean {
    const parts = value.split(':');
    return (parts.length === 3 || parts.length === 4)
        && parts.slice(0, 3).every((part) => /^[A-Za-z0-9_.-]+$/.test(part))
        && (parts.length === 3 || (parts[3].length > 0 && !/[\s\0]/.test(parts[3])));
}

function summarizeProfiles(profiles: Metadata, defaultProfile: string | undefined, resolvedProfile: string | undefined): {
    summaries: ProjectProfileSummary[]; truncated: boolean;
} {
    const names = Object.keys(profiles).filter(name => PROFILE_NAME.test(name)).sort();
    const truncated = names.length !== Object.keys(profiles).length || names.length > MAX_PROFILE_SUMMARIES;
    const includedNames = names.slice(0, MAX_PROFILE_SUMMARIES);
    // Keep the active and default profiles discoverable even in unusually large metadata.
    for (const preferred of [defaultProfile, resolvedProfile]) {
        if (preferred && names.includes(preferred) && !includedNames.includes(preferred)) {
            let replace = includedNames.length - 1;
            while (replace >= 0 && [defaultProfile, resolvedProfile].includes(includedNames[replace])) { replace--; }
            if (replace >= 0) { includedNames[replace] = preferred; }
        }
    }
    const dependencyBudget = { remainingBytes: MAX_PROFILE_SUMMARY_DEPENDENCY_BYTES };
    // Spend the shared dependency budget on selected/default profiles first.
    const priority = (name: string) => name === resolvedProfile ? 0 : name === defaultProfile ? 1 : 2;
    const summaries = includedNames.sort((left, right) => priority(left) - priority(right) || left.localeCompare(right)).map((name): ProjectProfileSummary => {
        const entry = profiles[name];
        const profile = isRecord(entry) ? entry : undefined;
        const profileIssues: AiIssue[] = [];
        let fqbn: string | undefined;
        if (!profile) {
            profileIssues.push({ code: 'INVALID_PROFILE', message: 'The profile must be a map.' });
        } else if (typeof profile.fqbn !== 'string' || !profile.fqbn.trim()) {
            profileIssues.push({ code: 'FQBN_REQUIRED', message: 'The profile does not declare an FQBN.' });
        } else if (Buffer.byteLength(JSON.stringify(profile.fqbn), 'utf8') > 4096 || /[\x00-\x1f\x7f]/.test(profile.fqbn) || !validFqbn(profile.fqbn.trim())) {
            profileIssues.push({ code: 'INVALID_FQBN', message: 'The profile FQBN is invalid.' });
        } else {
            fqbn = profile.fqbn.trim();
        }
        return {
            name, ...(fqbn ? { fqbn } : {}), isDefault: name === defaultProfile, isSelected: name === resolvedProfile,
            dependencies: inspectDeclaredDependencies(profile, dependencyBudget), issues: profileIssues,
        };
    }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    return { summaries, truncated };
}

function validateInput(input: InspectionInput): void {
    if (!isRecord(input) || Object.keys(input).some((key) => !['sketchPath', 'profile', 'clean'].includes(key))) {
        throw new AiBridgeError('INVALID_ARGUMENT', 'Only sketchPath, profile, and clean are accepted.');
    }
    if (input.profile !== undefined && (typeof input.profile !== 'string' || !PROFILE_NAME.test(input.profile))) {
        throw new AiBridgeError('INVALID_ARGUMENT', 'profile must be a named profile of at most 64 letters, digits, dots, underscores, or dashes, starting with a letter or digit.');
    }
    if (input.clean !== undefined && typeof input.clean !== 'boolean') {
        throw new AiBridgeError('INVALID_ARGUMENT', 'clean must be a boolean.');
    }
}

/**
 * Inspect only the explicitly identified active sketch. No VS Code state, CLI process,
 * repair, migration, or filesystem write is performed. Callers must redact execution
 * inputs before publishing them: build properties can intentionally contain secrets.
 */
export function inspectProject(input: InspectionInput, activeSketchPath: string): ProjectInspection {
    validateInput(input);
    const active = canonicalDirectory(activeSketchPath, 'Active sketch');
    const sketchPath = canonicalDirectory(input.sketchPath, 'sketchPath');
    if (path.relative(active, sketchPath) !== '') {
        throw new AiBridgeError('OUT_OF_SCOPE', 'sketchPath must identify the active sketch directory. Switching workspace folders is not supported by this operation.');
    }
    const sketchName = path.basename(sketchPath);
    const mainFile = scopedPath(sketchPath, path.join(sketchPath, `${sketchName}.ino`), 'Sketch file');
    try {
        if (!fs.statSync(mainFile).isFile()) {
            throw new Error('Not a file');
        }
    } catch {
        throw new AiBridgeError('INVALID_SKETCH', 'The sketch directory must contain a matching sketchName.ino file.');
    }

    const issues: AiIssue[] = [];
    const configurationPath = scopedPath(sketchPath, path.join(sketchPath, '.vscode', 'arduino.json'), 'Arduino configuration');
    const yamlPath = scopedPath(sketchPath, path.join(sketchPath, 'sketch.yaml'), 'Sketch metadata');
    const configurationRaw = readMetadata(configurationPath, 'Arduino configuration', issues);
    const yamlRaw = readMetadata(yamlPath, 'Sketch metadata', issues);
    let configuration: Metadata = {};
    let yaml: Metadata = {};
    if (configurationRaw !== undefined) {
        try {
            const parsed: unknown = JSON.parse(configurationRaw);
            if (!isRecord(parsed)) {
                throw new Error('Not an object');
            }
            configuration = parsed;
        } catch {
            issues.push({ code: 'INVALID_CONFIGURATION', message: 'Arduino configuration is invalid JSON or is not an object. Repair the file before compiling.' });
        }
    }
    if (yamlRaw !== undefined) {
        try {
            const parsed: unknown = parseYaml(yamlRaw, { maxAliasCount: 50 });
            if (!isRecord(parsed)) {
                throw new Error('Not a map');
            }
            yaml = parsed;
        } catch {
            issues.push({ code: 'INVALID_YAML', message: 'sketch.yaml is invalid YAML or is not a map. Repair the file before compiling.' });
        }
    }

    let profiles: Metadata = {};
    if (yaml.profiles !== undefined) {
        if (isRecord(yaml.profiles)) {
            profiles = yaml.profiles;
        } else {
            issues.push({ code: 'INVALID_PROFILES', message: 'sketch.yaml profiles must be a map of named profiles.' });
        }
    }
    const defaultProfile = optionalString(yaml, 'default_profile', 'default_profile', issues);
    const savedProfile = optionalString(configuration, 'compile_profile', 'compile_profile', issues);
    const defaultFqbn = optionalString(yaml, 'default_fqbn', 'default_fqbn', issues);
    const defaultPort = optionalString(yaml, 'default_port', 'default_port', issues);
    const defaultProtocol = optionalString(yaml, 'default_protocol', 'default_protocol', issues);
    const defaultProgrammer = optionalString(yaml, 'default_programmer', 'default_programmer', issues);
    const optimizeForDebug = optionalBoolean(configuration, 'optimize_for_debug', issues);
    const useProgrammer = optionalBoolean(configuration, 'useProgrammer', issues);
    const configurationRequired = optionalBoolean(configuration, 'configurationRequired', issues);
    let selectedProfile: string | undefined;
    let requestedProfile: string | undefined;
    if (input.profile !== undefined) {
        selectedProfile = input.profile;
        requestedProfile = input.profile;
    } else if (yamlRaw !== undefined && savedProfile) {
        selectedProfile = savedProfile;
        requestedProfile = savedProfile === DEFAULT_PROFILE ? defaultProfile : savedProfile;
    } else if (defaultProfile) {
        selectedProfile = DEFAULT_PROFILE;
        requestedProfile = defaultProfile;
    } else if (Object.keys(profiles).length > 0) {
        issues.push({ code: 'PROFILE_REQUIRED', message: 'Select an explicit profile or define default_profile before compiling this sketch.' });
    }
    let resolvedProfile: string | undefined;
    let profile: Metadata | undefined;
    if (selectedProfile) {
        if (!requestedProfile) {
            issues.push({ code: 'PROFILE_NOT_FOUND', message: 'The selected default profile is not defined. Select a named profile or define default_profile.' });
        } else if (!PROFILE_NAME.test(requestedProfile)) {
            issues.push({ code: 'INVALID_PROFILE', message: 'The selected profile name cannot safely identify a scoped build directory.' });
        } else if (!Object.hasOwn(profiles, requestedProfile) || !isRecord(profiles[requestedProfile])) {
            issues.push({ code: 'PROFILE_NOT_FOUND', message: 'The selected profile does not exist as a profile map in sketch.yaml.' });
        } else {
            resolvedProfile = requestedProfile;
            profile = profiles[requestedProfile] as Metadata;
        }
    }

    const board = optionalString(configuration, 'board', 'board', issues);
    const boardOptions = optionalString(configuration, 'configuration', 'configuration', issues);
    let fqbn: string | undefined;
    let port: string | undefined;
    let protocol: string | undefined;
    let programmer: string | undefined;
    const buildProperties: string[] = [];
    if (profile) {
        fqbn = optionalString(profile, 'fqbn', 'Profile FQBN', issues);
        port = optionalString(profile, 'port', 'Profile port', issues) ?? defaultPort;
        protocol = optionalString(profile, 'protocol', 'Profile protocol', issues) ?? defaultProtocol;
        programmer = optionalString(profile, 'programmer', 'Profile programmer', issues) ?? defaultProgrammer;
        if (profile.build_properties !== undefined) {
            if (!Array.isArray(profile.build_properties) || profile.build_properties.some((value) => typeof value !== 'string' || /[\0\r\n]/.test(value))) {
                issues.push({ code: 'INVALID_BUILD_PROPERTIES', message: 'Profile build_properties must be a list of single-line strings.' });
            } else {
                buildProperties.push(...profile.build_properties.map((value) => (value as string).trim()).filter(Boolean));
            }
        }
    } else if (!selectedProfile && Object.keys(profiles).length === 0) {
        fqbn = board ? (boardOptions ? `${board}:${boardOptions}` : board) : defaultFqbn;
        port = optionalString(configuration, 'port', 'port', issues) ?? defaultPort;
        protocol = defaultProtocol;
        programmer = useProgrammer
            ? optionalString(configuration, 'programmer', 'programmer', issues) ?? defaultProgrammer
            : defaultProgrammer;
        if (configurationRequired && board && !boardOptions && board.split(':').length === 3) {
            issues.push({ code: 'BOARD_OPTIONS_REQUIRED', message: 'The saved board requires board options. Configure them before compiling.' });
        }
    }
    if (!fqbn) {
        issues.push({ code: 'FQBN_REQUIRED', message: 'No resolved FQBN is available. Select a board, define default_fqbn, or select a valid profile.' });
    } else if (!validFqbn(fqbn)) {
        issues.push({ code: 'INVALID_FQBN', message: 'The resolved FQBN must have package:architecture:board and optional board options.' });
    }
    if (programmer === '<none>') {
        programmer = undefined;
    }
    const configuredOutput = optionalString(configuration, 'output', 'output', issues) ?? 'build';
    const buildRoot = scopedPath(sketchPath, path.resolve(sketchPath, configuredOutput), 'Build output');
    const buildPath = resolvedProfile
        ? scopedPath(sketchPath, path.join(buildRoot, `build_${resolvedProfile}`), 'Profile build output')
        : buildRoot;
    rejectReservedOutput(sketchPath, buildRoot);
    rejectReservedOutput(sketchPath, buildPath);
    requireOutputDirectory(buildRoot);
    requireOutputDirectory(buildPath);
    const sources = inspectSources(sketchPath, buildRoot, issues);
    const canCompile = issues.length === 0 && !!fqbn;
    const compileArgs: string[] = [];
    if (canCompile) {
        compileArgs.push('compile');
        if (resolvedProfile) {
            compileArgs.push('--profile', resolvedProfile);
        } else {
            compileArgs.push('--fqbn', fqbn!);
        }
        buildProperties.forEach((property) => compileArgs.push('--build-property', property));
        compileArgs.push('--build-path', buildPath, '--no-color', '--jobs', '0');
        if (optimizeForDebug) {
            compileArgs.push('--optimize-for-debug');
        }
        if (input.clean) {
            compileArgs.push('--clean');
        }
        compileArgs.push(sketchPath);
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
        schemaVersion: 1,
        sketchPath,
        configurationRaw: configurationRaw ?? null,
        yamlRaw: yamlRaw ?? null,
        explicitProfile: input.profile ?? null,
        clean: input.clean ?? false,
        buildPath,
        sources: sources ?? null,
    })).digest('hex');
    const profileSummary = summarizeProfiles(profiles, defaultProfile, resolvedProfile);
    return {
        schemaVersion: 1,
        sketchPath,
        sketchName,
        configurationPath,
        ...(yamlRaw !== undefined ? { profilePath: yamlPath } : {}),
        ...(selectedProfile ? { selectedProfile } : {}),
        ...(resolvedProfile ? { resolvedProfile } : {}),
        ...(defaultProfile && PROFILE_NAME.test(defaultProfile) ? { defaultProfile } : {}),
        availableProfiles: profileSummary.summaries,
        ...(profileSummary.truncated ? { availableProfilesTruncated: true } : {}),
        declaredDependencies: inspectDeclaredDependencies(profile),
        ...(fqbn ? { fqbn } : {}),
        ...(port ? { port } : {}),
        ...(protocol ? { protocol } : {}),
        ...(programmer ? { programmer } : {}),
        buildPath,
        buildProperties,
        compileArgs,
        fingerprint,
        canCompile,
        issues,
    };
}
