import { AiBridgeError, AiIssue, DeclaredDependencies, DeclaredLibraryDependency, DeclaredPlatformDependency, ProjectInspection } from './contracts';

const MAX_ENTRIES = 1000;
const MAX_REPORT_BYTES = 256 * 1024;
const INVENTORY_SCOPE = 'standard_cli_installations' as const;

interface InstalledPlatform { id: string; version?: string; name?: string; }
interface InstalledLibrary { name: string; version?: string; location?: string; containerPlatform?: string; }
type DependencyStatus = 'installed' | 'not_found' | 'version_mismatch' | 'unknown';
interface DependencyComparison<T> { requirement: T; status: DependencyStatus; installedVersions: string[]; }

export interface DependencyReport {
    schemaVersion: 1;
    sketchPath: string;
    profile?: string;
    declared: DeclaredDependencies;
    declaredComplete: boolean;
    installed: {
        scope: typeof INVENTORY_SCOPE;
        complete: boolean;
        platforms: InstalledPlatform[];
        libraries: InstalledLibrary[];
        issues: AiIssue[];
    };
    comparison: {
        scope: typeof INVENTORY_SCOPE;
        platforms: DependencyComparison<DeclaredPlatformDependency>[];
        libraries: DependencyComparison<DeclaredLibraryDependency>[];
    };
    buildResolved: { status: 'not_reported'; reason: string; };
    notes: string[];
}

function invalidOutput(): never {
    throw new AiBridgeError('INVALID_CLI_OUTPUT', 'Arduino CLI returned invalid or oversized dependency inventory.');
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { return invalidOutput(); }
    return value as Record<string, unknown>;
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

function list(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length > MAX_ENTRIES) { return invalidOutput(); }
    return value;
}

function inventory(value: unknown, field: string): { entries: unknown[]; complete: boolean } {
    const object = record(value);
    const entries = list(object[field]);
    // Initialization warnings can mean missing platforms/libraries. Do not turn
    // partial results into a definitive "not found" or echo machine paths.
    const warnings = object.warnings === undefined ? [] : list(object.warnings);
    warnings.forEach(warning => {
        if (typeof warning !== 'string' || warning.length > 8192) { invalidOutput(); }
    });
    return { entries, complete: warnings.length === 0 };
}

function installedPlatform(value: unknown): InstalledPlatform {
    const item = record(value);
    const id = text(item.id, true, 256)!;
    const version = text(item.installed_version, false, 128);
    let name: string | undefined;
    if (item.releases !== undefined) {
        const releases = record(item.releases);
        if (Object.keys(releases).length > MAX_ENTRIES) { return invalidOutput(); }
        // Use only the installed release; latest metadata describes another version.
        if (version && Object.hasOwn(releases, version)) {
            const release = record(releases[version]);
            name = text(release.name);
        }
    }
    return { id, ...(version ? { version } : {}), ...(name ? { name } : {}) };
}

function installedLibrary(value: unknown): InstalledLibrary {
    const item = record(record(value).library);
    const name = text(item.name, true)!;
    const version = text(item.version, false, 128);
    const location = text(item.location, false, 128);
    const containerPlatform = text(item.container_platform, false, 256);
    // Legacy/manual libraries can legitimately omit their version. Exclude raw
    // properties, install paths, author details, URLs, examples, and latest releases.
    return {
        name,
        ...(version ? { version } : {}),
        ...(location ? { location } : {}),
        ...(containerPlatform ? { containerPlatform } : {}),
    };
}

function releaseIdentity(version: string): string {
    // Arduino's relaxed-semver NormalizedString pads omitted numeric components.
    // Core/library release maps keep prerelease AND build metadata in their keys;
    // semver precedence equality (which ignores build metadata) is not sufficient.
    const parsed = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
    if (!parsed || parsed[4]?.slice(1).split('.').some(identifier => /^0\d+$/.test(identifier))) { return version; }
    return `${parsed[1]}.${parsed[2] ?? '0'}.${parsed[3] ?? '0'}${parsed[4] ?? ''}${parsed[5] ?? ''}`;
}

function compare<T>(requirement: T, version: string | undefined, matches: { version?: string }[], complete: boolean): DependencyComparison<T> {
    const installedVersions = [...new Set(matches.flatMap(match => match.version ? [match.version] : []))].sort();
    let status: DependencyStatus;
    if (matches.length && (!version || installedVersions.some(installed => releaseIdentity(installed) === releaseIdentity(version)))) {
        status = 'installed';
    } else if (!complete || matches.some(match => !match.version)) {
        status = 'unknown';
    } else {
        status = matches.length ? 'version_mismatch' : 'not_found';
    }
    return { requirement, status, installedVersions };
}

/** Inventory comparisons describe standard CLI installations, never profile build resolution. */
export function buildDependencyReport(target: ProjectInspection, cores: unknown, libraries: unknown): DependencyReport {
    const coreInventory = inventory(cores, 'platforms');
    const libraryInventory = inventory(libraries, 'installed_libraries');
    const installedPlatforms = coreInventory.entries.map(installedPlatform);
    const installedLibraries = libraryInventory.entries.map(installedLibrary);
    const complete = coreInventory.complete && libraryInventory.complete;
    const declarationProblem = new Set(['INVALID_YAML', 'INVALID_PROFILES', 'PROFILE_REQUIRED', 'PROFILE_NOT_FOUND',
        'INVALID_PROFILE', 'INVALID_METADATA', 'METADATA_UNREADABLE', 'INVALID_CONFIGURATION']);
    const declaredComplete = target.declaredDependencies.issues.length === 0 && !target.issues.some(issue => declarationProblem.has(issue.code));
    const report: DependencyReport = {
        schemaVersion: 1,
        sketchPath: target.sketchPath,
        ...(target.resolvedProfile ? { profile: target.resolvedProfile } : {}),
        declared: target.declaredDependencies,
        declaredComplete,
        installed: {
            scope: INVENTORY_SCOPE,
            complete,
            platforms: installedPlatforms,
            libraries: installedLibraries,
            issues: complete ? [] : [{
                code: 'CLI_INVENTORY_INCOMPLETE',
                message: 'Arduino CLI reported initialization warnings; the standard installation inventory may be incomplete.',
            }],
        },
        comparison: {
            scope: INVENTORY_SCOPE,
            platforms: target.declaredDependencies.platforms.map(requirement => compare(
                requirement, requirement.version, installedPlatforms.filter(platform => platform.id === requirement.id), coreInventory.complete,
            )),
            libraries: target.declaredDependencies.libraries.map(requirement => requirement.kind === 'local'
                ? { requirement, status: 'unknown', installedVersions: [] }
                : compare(requirement, requirement.version, installedLibraries.filter(library => library.name === requirement.name), libraryInventory.complete)),
        },
        buildResolved: {
            status: 'not_reported',
            reason: 'Dependencies actually selected by a build and isolated profile caches are not inspected by this tool.',
        },
        notes: [
            'Comparisons use standard Arduino CLI installations only. Profile builds can use isolated dependencies; inventory differences do not establish whether compilation will succeed.',
            'Local library directories are declared paths only; their contents and versions are not inspected.',
            ...(!declaredComplete ? ['Profile dependency declarations could not be reported completely; inspect the project and declaration issues before drawing conclusions.']
                : !target.resolvedProfile ? ['No build profile is selected; no profile dependency requirements are declared.'] : []),
        ],
    };
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_REPORT_BYTES) { return invalidOutput(); }
    return report;
}
