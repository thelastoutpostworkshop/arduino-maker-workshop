import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectInspection } from './contracts';

const MAX_DIRECTORY_ENTRIES = 4096;
const MAX_ARTIFACTS = 64;
const MAX_PATH_BYTES = 4096;
const MAX_REPORT_PATH_BYTES = 64 * 1024;
const MAX_NOTES = 8;
const ARTIFACT_EXTENSIONS = new Set(['.elf', '.bin', '.hex', '.uf2', '.map', '.eep']);
const SUPPORT_BINARIES = new Set(['bootloader.bin', 'partitions.bin', 'boot_app0.bin']);

export interface CompileArtifact {
    path: string;
    relativePath: string;
    kind: 'elf' | 'bin' | 'hex' | 'uf2' | 'map' | 'eep';
    sizeBytes: number;
}

export interface CompileArtifactReport {
    status: 'available' | 'partial' | 'unavailable';
    files: CompileArtifact[];
    notes: string[];
}

interface FileMetadata {
    identity: string;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
}

interface BuildScope {
    sketchPath: string;
    buildPath: string;
    sketchIdentity: string;
    buildIdentity?: string;
    buildMtimeNs?: bigint;
}

export interface CompileArtifactSnapshot {
    readonly sketchPath: string;
    readonly buildPath: string;
    readonly fingerprint: string;
    readonly complete: boolean;
    readonly scope?: BuildScope;
    readonly files: ReadonlyMap<string, FileMetadata>;
    readonly notes: readonly string[];
}

interface ArtifactScan {
    complete: boolean;
    scope?: BuildScope;
    files: Map<string, FileMetadata>;
    notes: string[];
}

function within(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function samePath(left: string, right: string): boolean {
    return path.relative(left, right) === '';
}

function identity(stat: fs.BigIntStats): string {
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

function metadata(stat: fs.BigIntStats): FileMetadata {
    return { identity: identity(stat), size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
}

function sameMetadata(left: FileMetadata, right: FileMetadata): boolean {
    return left.identity === right.identity && left.size === right.size
        && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function changedOutput(before: FileMetadata | undefined, after: FileMetadata): boolean {
    // A chmod or other metadata-only ctime change does not establish that a new output was written.
    return !before || before.identity !== after.identity || before.size !== after.size || before.mtimeNs !== after.mtimeNs;
}

function addNote(scan: ArtifactScan, message: string): void {
    scan.complete = false;
    if (scan.notes.length < MAX_NOTES && !scan.notes.includes(message)) { scan.notes.push(message); }
}

function validPath(value: string): boolean {
    return typeof value === 'string' && path.isAbsolute(value) && !/[\0\r\n]/.test(value)
        && Buffer.byteLength(value, 'utf8') <= MAX_PATH_BYTES;
}

/** Resolve the existing ancestors of a not-yet-created output, without accepting links. */
async function inspectScope(target: ProjectInspection): Promise<BuildScope> {
    if (!validPath(target.sketchPath) || !validPath(target.buildPath)) { throw new Error('Invalid artifact directory.'); }
    const sketchPath = path.resolve(target.sketchPath);
    const buildPath = path.resolve(target.buildPath);
    if (!within(sketchPath, buildPath) || samePath(sketchPath, buildPath)) { throw new Error('Artifact directory is outside the sketch.'); }

    const sketchStat = await fs.promises.lstat(sketchPath, { bigint: true });
    if (!sketchStat.isDirectory() || sketchStat.isSymbolicLink()
        || !samePath(sketchPath, await fs.promises.realpath(sketchPath))) { throw new Error('Sketch directory changed scope.'); }

    let ancestor = buildPath;
    let buildStat: fs.BigIntStats | undefined;
    while (true) {
        try {
            const stat = await fs.promises.lstat(ancestor, { bigint: true });
            if (!stat.isDirectory() || stat.isSymbolicLink()
                || !samePath(ancestor, await fs.promises.realpath(ancestor))) { throw new Error('Artifact directory contains a link or is not a directory.'); }
            if (samePath(ancestor, buildPath)) { buildStat = stat; }
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
            ancestor = path.dirname(ancestor);
            if (!within(sketchPath, ancestor)) { throw new Error('Artifact directory cannot be scoped.'); }
        }
    }
    const sketchAfter = await fs.promises.lstat(sketchPath, { bigint: true });
    if (identity(sketchStat) !== identity(sketchAfter)) { throw new Error('Sketch directory changed during inspection.'); }
    return {
        sketchPath, buildPath, sketchIdentity: identity(sketchStat),
        buildIdentity: buildStat ? identity(buildStat) : undefined,
        buildMtimeNs: buildStat?.mtimeNs,
    };
}

function sameDirectories(before: BuildScope, after: BuildScope): boolean {
    return before.sketchIdentity === after.sketchIdentity && before.buildIdentity === after.buildIdentity
        && samePath(before.sketchPath, after.sketchPath) && samePath(before.buildPath, after.buildPath);
}

function isArtifactName(name: string, sketchName: string): boolean {
    const extension = path.extname(name).toLowerCase();
    if (!ARTIFACT_EXTENSIONS.has(extension)) { return false; }
    const normalized = name.toLowerCase();
    const sketch = sketchName.toLowerCase();
    return normalized.startsWith(`${sketch}.`) || SUPPORT_BINARIES.has(normalized);
}

/** Final Arduino CLI outputs are at the build root; nested object/library caches are excluded. */
async function scanArtifacts(target: ProjectInspection): Promise<ArtifactScan> {
    const scan: ArtifactScan = { complete: true, files: new Map(), notes: [] };
    let handle: fs.Dir | undefined;
    try {
        scan.scope = await inspectScope(target);
        if (scan.scope.buildIdentity === undefined) { return scan; }
        handle = await fs.promises.opendir(scan.scope.buildPath);
        const opened = await inspectScope(target);
        if (!sameDirectories(scan.scope, opened)) { throw new Error('Artifact directory changed while opening.'); }
        let entry: fs.Dirent | null;
        let visited = 0;
        let pathBytes = 0;
        while ((entry = await handle.read()) !== null) {
            if (++visited > MAX_DIRECTORY_ENTRIES) {
                addNote(scan, 'Artifact inspection reached its directory-entry limit; additional outputs were not inspected.');
                break;
            }
            if (!isArtifactName(entry.name, target.sketchName)) { continue; }
            if (scan.files.size >= MAX_ARTIFACTS) {
                addNote(scan, 'Artifact inspection reached its file limit; additional outputs were not inspected.');
                break;
            }
            const filePath = path.join(scan.scope.buildPath, entry.name);
            const bytes = Buffer.byteLength(filePath, 'utf8') + Buffer.byteLength(entry.name, 'utf8');
            if (!validPath(filePath) || pathBytes + bytes > MAX_REPORT_PATH_BYTES) {
                addNote(scan, 'Artifact paths exceeded the bounded report size; some outputs were not inspected.');
                continue;
            }
            try {
                if (!sameDirectories(scan.scope, await inspectScope(target))) { throw new Error('Artifact directory changed.'); }
                const before = await fs.promises.lstat(filePath, { bigint: true });
                if (before.isSymbolicLink()) {
                    addNote(scan, 'Linked artifact files were excluded; only ordinary files inside the build output are reported.');
                    continue;
                }
                if (!before.isFile()) { continue; }
                const canonical = await fs.promises.realpath(filePath);
                if (!within(scan.scope.buildPath, canonical) || !samePath(filePath, canonical)) {
                    addNote(scan, 'Artifact files that changed scope were excluded.');
                    continue;
                }
                const after = await fs.promises.lstat(filePath, { bigint: true });
                if (!after.isFile() || after.isSymbolicLink() || !sameMetadata(metadata(before), metadata(after))) {
                    addNote(scan, 'Artifact files changed during inspection; those files were excluded.');
                    continue;
                }
                if (after.size > BigInt(Number.MAX_SAFE_INTEGER)) {
                    addNote(scan, 'An artifact size exceeded the supported report range.');
                    continue;
                }
                scan.files.set(entry.name, metadata(after));
                pathBytes += bytes;
            } catch {
                addNote(scan, 'Some artifact metadata could not be inspected safely; those files were excluded.');
            }
        }
        const finished = await inspectScope(target);
        if (!sameDirectories(scan.scope, finished)) { throw new Error('Artifact directory changed during inspection.'); }
        if (scan.scope.buildMtimeNs !== finished.buildMtimeNs) {
            scan.files.clear();
            addNote(scan, 'The build output changed during artifact inspection; output freshness could not be established.');
        }
    } catch {
        scan.files.clear();
        scan.scope = undefined;
        addNote(scan, 'Build artifacts could not be inspected safely inside the sketch output directory.');
    } finally {
        if (handle) { await handle.close().catch(() => undefined); }
    }
    return scan;
}

export async function snapshotCompileArtifacts(target: ProjectInspection): Promise<CompileArtifactSnapshot> {
    const scan = await scanArtifacts(target);
    return {
        sketchPath: target.sketchPath, buildPath: target.buildPath, fingerprint: target.fingerprint,
        complete: scan.complete, scope: scan.scope, files: scan.files, notes: scan.notes,
    };
}

export function unavailableCompileArtifacts(reason: string): CompileArtifactReport {
    return { status: 'unavailable', files: [], notes: [reason.slice(0, 2048)] };
}

/** Call only after a successful build; the caller must also reject canceled or stale results. */
export async function collectCompileArtifacts(target: ProjectInspection, snapshot: CompileArtifactSnapshot): Promise<CompileArtifactReport> {
    if (!snapshot.complete || !snapshot.scope) {
        const report = unavailableCompileArtifacts('Artifacts are unavailable because the pre-build output snapshot was incomplete; current-build freshness could not be established.');
        report.notes.push(...snapshot.notes.slice(0, MAX_NOTES - 1));
        return report;
    }
    if (!samePath(target.sketchPath, snapshot.sketchPath) || !samePath(target.buildPath, snapshot.buildPath)
        || target.fingerprint !== snapshot.fingerprint) {
        return unavailableCompileArtifacts('Artifacts are unavailable because the inspected sketch or build target changed.');
    }
    const scan = await scanArtifacts(target);
    if (!scan.scope || scan.scope.sketchIdentity !== snapshot.scope.sketchIdentity) {
        return unavailableCompileArtifacts('Artifacts are unavailable because the sketch directory was replaced or the build output could not be inspected safely.');
    }
    if (scan.scope.buildIdentity === undefined) {
        return unavailableCompileArtifacts('The build output directory is unavailable; no current-build artifacts could be verified.');
    }
    // Arduino CLI recreates the output directory for clean builds and changed build options.
    // Its identity may change between the two stable scans while its canonical scope stays fixed.
    const recreated = snapshot.scope.buildIdentity !== undefined && snapshot.scope.buildIdentity !== scan.scope.buildIdentity;
    const files: CompileArtifact[] = [];
    let unchanged = false;
    for (const [name, value] of scan.files) {
        if (!recreated && !changedOutput(snapshot.files.get(name), value)) { unchanged = true; continue; }
        files.push({
            path: path.join(scan.scope.buildPath, name), relativePath: name,
            kind: path.extname(name).slice(1).toLowerCase() as CompileArtifact['kind'], sizeBytes: Number(value.size),
        });
    }
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const notes = ['Only sketch-named firmware/debug files and standard ESP32 support binaries directly in the build output are inspected; other platform outputs and nested files are excluded.', ...scan.notes];
    if (unchanged) { notes.push('Unchanged cached output files were omitted because they could not be verified as newly produced by this build.'); }
    if (files.length === 0) { notes.push('No newly produced firmware or debug artifacts could be verified in the build output directory.'); }
    return { status: files.length === 0 ? 'unavailable' : scan.complete ? 'available' : 'partial', files, notes: notes.slice(0, MAX_NOTES) };
}
