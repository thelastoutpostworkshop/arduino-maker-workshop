import { AiIssue, DeclaredDependencies, DeclaredLibraryDependency, DeclaredPlatformDependency } from './contracts';

const MAX_DECLARATIONS = 200;
const MAX_DECLARATION_LENGTH = 4096;
const MAX_PROFILE_DEPENDENCY_BYTES = 128 * 1024;

export interface DependencyMetadataBudget { remainingBytes: number; }

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function singleLine(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > MAX_DECLARATION_LENGTH || /[\x00-\x1f\x7f]/.test(value)) {
        return undefined;
    }
    return value.trim() || undefined;
}

/** Read only declaration text. In particular, never resolve or inspect a local library directory. */
function nameAndVersion(value: unknown): { name: string; version?: string } | undefined {
    const text = singleLine(value);
    if (!text) { return undefined; }
    const versioned = /^(.*?)\s*\(([^()]+)\)$/.exec(text);
    if (versioned) {
        const name = versioned[1].trim();
        const version = versioned[2].trim();
        if (!name || !version || /[()]/.test(name)) { return undefined; }
        return { name, version };
    }
    return /[()]/.test(text) ? undefined : { name: text };
}

function declarations(value: unknown, kind: 'platforms' | 'libraries', issues: AiIssue[]): unknown[] {
    if (value === undefined) { return []; }
    if (!Array.isArray(value)) {
        issues.push({ code: 'INVALID_DEPENDENCIES', message: `Profile ${kind} must be a list.` });
        return [];
    }
    if (value.length > MAX_DECLARATIONS) {
        issues.push({ code: 'DEPENDENCY_LIST_TRUNCATED', message: `Only the first ${MAX_DECLARATIONS} declared ${kind} are included.` });
    }
    return value.slice(0, MAX_DECLARATIONS);
}

export function inspectDeclaredDependencies(
    profile?: Record<string, unknown>,
    budget: DependencyMetadataBudget = { remainingBytes: MAX_PROFILE_DEPENDENCY_BYTES },
): DeclaredDependencies {
    const result: DeclaredDependencies = { platforms: [], libraries: [], issues: [] };
    if (!profile) { return result; }
    let usedBytes = 0;
    const reserve = (value: DeclaredPlatformDependency | DeclaredLibraryDependency): boolean => {
        const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
        if (bytes > budget.remainingBytes || usedBytes + bytes > MAX_PROFILE_DEPENDENCY_BYTES) {
            if (!result.issues.some(issue => issue.code === 'DEPENDENCY_METADATA_TRUNCATED')) {
                result.issues.push({ code: 'DEPENDENCY_METADATA_TRUNCATED', message: 'Dependency declarations exceed the bounded metadata budget; remaining entries are omitted.' });
            }
            return false;
        }
        budget.remainingBytes -= bytes;
        usedBytes += bytes;
        return true;
    };
    let invalidPlatforms = false;
    for (const entry of declarations(profile.platforms, 'platforms', result.issues)) {
        const parsed = isRecord(entry) ? nameAndVersion(entry.platform) : undefined;
        if (!parsed || !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(parsed.name)) {
            invalidPlatforms = true;
            continue;
        }
        const dependency: DeclaredPlatformDependency = { id: parsed.name, ...(parsed.version ? { version: parsed.version } : {}) };
        if (isRecord(entry) && entry.platform_index_url !== undefined) {
            const indexUrl = singleLine(entry.platform_index_url);
            try {
                if (!indexUrl) { throw new Error('Invalid URL'); }
                const parsedUrl = new URL(indexUrl);
                if (parsedUrl.username || parsedUrl.password) {
                    parsedUrl.username = '';
                    parsedUrl.password = '';
                    dependency.indexUrl = parsedUrl.toString();
                } else { dependency.indexUrl = indexUrl; }
            } catch { invalidPlatforms = true; }
        }
        if (!reserve(dependency)) { break; }
        result.platforms.push(dependency);
    }
    if (invalidPlatforms) {
        result.issues.push({ code: 'INVALID_PLATFORM_DEPENDENCY', message: 'One or more platform declarations are invalid or contain an invalid index URL.' });
    }
    let invalidLibraries = false;
    for (const entry of declarations(profile.libraries, 'libraries', result.issues)) {
        let dependency: DeclaredLibraryDependency | undefined;
        if (isRecord(entry) && Object.hasOwn(entry, 'dir') && !Object.hasOwn(entry, 'dependency')) {
            const directory = singleLine(entry.dir);
            if (directory) { dependency = { kind: 'local', directory }; }
        } else if (typeof entry === 'string' || (isRecord(entry) && !Object.hasOwn(entry, 'dir'))) {
            const parsed = nameAndVersion(typeof entry === 'string' ? entry : entry.dependency);
            if (parsed) {
                dependency = { kind: 'index', ...parsed, ...(typeof entry === 'string' ? {} : { transitive: true }) };
            }
        }
        if (dependency) {
            if (!reserve(dependency)) { break; }
            result.libraries.push(dependency);
        }
        else { invalidLibraries = true; }
    }
    if (invalidLibraries) {
        result.issues.push({ code: 'INVALID_LIBRARY_DEPENDENCY', message: 'One or more library declarations are invalid.' });
    }
    return result;
}
