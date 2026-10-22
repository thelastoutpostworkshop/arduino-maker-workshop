import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { AiBridgeError, type ProjectInspection } from './contracts';
import {
    extractBacktraceAddresses, extractChipFromString, findAddr2LineBinary, isEsp32ProfileToolDirectory,
    MAX_BACKTRACE_LOG_BYTES, resolveEsp32Arch, runAddr2Line,
    type BacktraceArchitecture,
} from '../esp32Backtrace';
import type { BacktraceDecodeFrame } from '../shared/messages';

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_ELF_BYTES = 128 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MARKER_NAME = 'compile_result.json';

interface FileStamp {
    identity: string;
    sizeBytes: number;
    mtimeNs: string;
    ctimeNs: string;
}

interface BuildScope {
    sketchPath: string;
    buildPath: string;
    sketchIdentity: string;
    buildIdentity: string;
}

export interface BacktraceBuildRecord extends BuildScope {
    schemaVersion: 1;
    buildFingerprint: string;
    fqbn: string;
    profile?: string;
    chipId?: string;
    elf: FileStamp & {
        name: string;
        architecture: BacktraceArchitecture;
        sha256: string;
    };
}

export interface BacktraceDecodeResult {
    schemaVersion: 1;
    status: 'success' | 'partial';
    target: { sketchPath: string; profile?: string; fqbn: string; buildPath: string };
    architecture: BacktraceArchitecture;
    elfPath: string;
    decoderPath: string;
    frames: BacktraceDecodeFrame[];
    stdout: string;
    stderr: string;
    truncated: boolean;
    durationMs: number;
    notes: string[];
}

function canceled(signal?: AbortSignal): void {
    if (signal?.aborted) { throw new AiBridgeError('CANCELED', 'Backtrace decoding was canceled.'); }
}

function within(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function samePath(left: string, right: string): boolean { return path.relative(left, right) === ''; }

function validPath(value: string): boolean {
    return typeof value === 'string' && path.isAbsolute(value) && !/[\0\r\n]/.test(value)
        && Buffer.byteLength(value, 'utf8') <= MAX_PATH_BYTES;
}

function identity(stat: fs.BigIntStats): string { return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`; }

function stamp(stat: fs.BigIntStats): FileStamp {
    return { identity: identity(stat), sizeBytes: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}

function sameStamp(left: FileStamp, right: FileStamp): boolean {
    return left.identity === right.identity && left.sizeBytes === right.sizeBytes
        && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function ordinaryDirectory(directory: string): Promise<fs.BigIntStats> {
    if (!validPath(directory)) { throw new Error('Invalid directory.'); }
    const before = await fs.promises.lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || !samePath(directory, await fs.promises.realpath(directory))) {
        throw new Error('Directory is linked or changed scope.');
    }
    const after = await fs.promises.lstat(directory, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink() || identity(before) !== identity(after)) { throw new Error('Directory changed.'); }
    return after;
}

async function inspectScope(target: ProjectInspection): Promise<BuildScope> {
    if (!validPath(target.sketchPath) || !validPath(target.buildPath)
        || !within(target.sketchPath, target.buildPath) || samePath(target.sketchPath, target.buildPath)) {
        throw new AiBridgeError('INVALID_BUILD_PATH', 'The matching build output must be inside the selected sketch.');
    }
    try {
        const sketch = await ordinaryDirectory(target.sketchPath);
        let current = target.buildPath;
        const build = await ordinaryDirectory(current);
        while (!samePath(current, target.sketchPath)) {
            current = path.dirname(current);
            await ordinaryDirectory(current);
        }
        if (identity(sketch) !== identity(await ordinaryDirectory(target.sketchPath))) { throw new Error('Sketch changed.'); }
        return { sketchPath: target.sketchPath, buildPath: target.buildPath,
            sketchIdentity: identity(sketch), buildIdentity: identity(build) };
    } catch {
        throw new AiBridgeError('BUILD_REQUIRED', 'Compile this sketch and profile through the assistant first; its ordinary build directory is unavailable.');
    }
}

function sameScope(before: BuildScope, after: BuildScope): boolean {
    return samePath(before.sketchPath, after.sketchPath) && samePath(before.buildPath, after.buildPath)
        && before.sketchIdentity === after.sketchIdentity && before.buildIdentity === after.buildIdentity;
}

async function ordinaryFile(filePath: string): Promise<fs.BigIntStats> {
    if (!validPath(filePath)) { throw new Error('Invalid file path.'); }
    const stat = await fs.promises.lstat(filePath, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || !samePath(filePath, await fs.promises.realpath(filePath))) {
        throw new Error('File is linked or changed scope.');
    }
    return stat;
}

/** Read only a bounded ordinary metadata file, checking the opened handle and final path. */
async function readMetadata(filePath: string): Promise<{ data: Buffer; stamp: FileStamp }> {
    const before = await ordinaryFile(filePath);
    if (before.size > BigInt(MAX_METADATA_BYTES)) { throw new Error('Metadata exceeds its bounded size.'); }
    const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || !sameStamp(stamp(before), stamp(opened))) { throw new Error('Metadata changed while opening.'); }
        const data = Buffer.alloc(Number(opened.size));
        let offset = 0;
        while (offset < data.length) {
            const read = await handle.read(data, offset, data.length - offset, offset);
            if (read.bytesRead === 0) { throw new Error('Metadata ended unexpectedly.'); }
            offset += read.bytesRead;
        }
        if (!sameStamp(stamp(before), stamp(await handle.stat({ bigint: true })))
            || !sameStamp(stamp(before), stamp(await ordinaryFile(filePath)))) { throw new Error('Metadata changed while reading.'); }
        return { data, stamp: stamp(before) };
    } finally { await handle.close(); }
}

function requireEsp32(target: ProjectInspection): void {
    if (target.fqbn?.split(':')[1] !== 'esp32') {
        throw new AiBridgeError('UNSUPPORTED_TARGET', 'Backtrace decoding supports ESP32 targets only. Select the ESP32 sketch and profile that produced the crash.');
    }
}

async function selectElf(target: ProjectInspection): Promise<string> {
    if (!target.sketchName || path.basename(target.sketchName) !== target.sketchName || /[\0\r\n]/.test(target.sketchName)) {
        throw new AiBridgeError('INVALID_TARGET', 'The inspected sketch name cannot identify its ELF.');
    }
    const candidates: string[] = [];
    for (const name of [`${target.sketchName}.ino.elf`, `${target.sketchName}.pde.elf`]) {
        const filePath = path.join(target.buildPath, name);
        try { await ordinaryFile(filePath); candidates.push(filePath); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw new AiBridgeError('UNSAFE_ELF', 'The matching ELF must be an ordinary file in the selected build directory.');
            }
        }
    }
    if (candidates.length !== 1) {
        throw new AiBridgeError(candidates.length ? 'AMBIGUOUS_ELF' : 'ELF_NOT_FOUND', candidates.length
            ? 'The selected output contains multiple matching ELFs. Clean compile this sketch and profile before decoding.'
            : 'No matching sketch ELF exists in the selected build output. Compile this sketch and profile through the assistant first.');
    }
    return candidates[0];
}

function elfArchitecture(header: Buffer): BacktraceArchitecture {
    if (header.length < 52 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
        throw new AiBridgeError('INVALID_ELF', 'The matching artifact is not an ELF executable.');
    }
    if (header[4] !== 1 || header[5] !== 1 || header[6] !== 1 || header.readUInt16LE(16) !== 2
        || header.readUInt32LE(20) !== 1 || header.readUInt16LE(40) !== 52) {
        throw new AiBridgeError('UNSUPPORTED_ELF', 'Only 32-bit little-endian ESP32 ELF executables are supported.');
    }
    const machine = header.readUInt16LE(18);
    if (machine === 94) { return 'xtensa'; }
    if (machine === 243) { return 'riscv'; }
    throw new AiBridgeError('UNSUPPORTED_ARCHITECTURE', 'The ELF does not use a supported ESP32 Xtensa or RISC-V architecture.');
}

/** Hash the entire ELF with bounded memory and bytes; identity and timestamps alone are insufficient. */
async function inspectElf(filePath: string, signal?: AbortSignal): Promise<BacktraceBuildRecord['elf']> {
    canceled(signal);
    const before = await ordinaryFile(filePath);
    if (before.size < 52n || before.size > BigInt(MAX_ELF_BYTES)) {
        throw new AiBridgeError('INVALID_ELF', 'The matching ELF must be between 52 bytes and 128 MiB.');
    }
    const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || !sameStamp(stamp(before), stamp(opened))) { throw new Error('ELF changed while opening.'); }
        const buffer = Buffer.alloc(64 * 1024);
        const hash = createHash('sha256');
        let offset = 0;
        let architecture: BacktraceArchitecture | undefined;
        while (offset < Number(opened.size)) {
            canceled(signal);
            const read = await handle.read(buffer, 0, Math.min(buffer.length, Number(opened.size) - offset), offset);
            if (!read.bytesRead) { throw new Error('ELF ended unexpectedly.'); }
            if (offset === 0) { architecture = elfArchitecture(buffer.subarray(0, read.bytesRead)); }
            hash.update(buffer.subarray(0, read.bytesRead));
            offset += read.bytesRead;
        }
        if (!sameStamp(stamp(before), stamp(await handle.stat({ bigint: true })))
            || !sameStamp(stamp(before), stamp(await ordinaryFile(filePath)))) { throw new Error('ELF changed while reading.'); }
        return { ...stamp(before), name: path.basename(filePath), architecture: architecture!, sha256: hash.digest('hex') };
    } finally { await handle.close(); }
}

async function inspectChip(target: ProjectInspection, architecture: BacktraceArchitecture): Promise<string | undefined> {
    const explicit = target.buildProperties.find(value => value.startsWith('build.mcu='))?.slice('build.mcu='.length);
    let metadataChip: unknown;
    try {
        const metadata = JSON.parse((await readMetadata(path.join(target.buildPath, 'build.options.json'))).data.toString('utf8'));
        if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) { metadataChip = metadata['build.mcu']; }
    } catch { /* Optional metadata never selects a different build or an arbitrary executable. */ }
    for (const value of [explicit, metadataChip, target.fqbn?.split(':')[2]]) {
        const chip = extractChipFromString(value);
        if (!chip) { continue; }
        const expected = resolveEsp32Arch(chip);
        if (expected === architecture) { return chip; }
        if (expected) { throw new AiBridgeError('ELF_TARGET_MISMATCH', 'The matching ELF architecture does not match the selected ESP32 target. Compile the selected target again.'); }
    }
    return undefined;
}

/** Capture only after a successful assistant build. Unsupported or missing debug output must not fail compilation. */
export async function createBacktraceBuildRecord(target: ProjectInspection): Promise<BacktraceBuildRecord | undefined> {
    try {
        requireEsp32(target);
        const scope = await inspectScope(target);
        const elf = await inspectElf(await selectElf(target));
        const chipId = await inspectChip(target, elf.architecture);
        if (!sameScope(scope, await inspectScope(target))) { return undefined; }
        return { schemaVersion: 1, ...scope, buildFingerprint: target.buildFingerprint, fqbn: target.fqbn!,
            ...(target.resolvedProfile ? { profile: target.resolvedProfile } : {}), ...(chipId ? { chipId } : {}), elf };
    } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function isBuildRecord(value: unknown): value is BacktraceBuildRecord {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.elf)) { return false; }
    const elf = value.elf;
    return ['sketchPath', 'buildPath', 'sketchIdentity', 'buildIdentity', 'fqbn'].every(key => typeof value[key] === 'string')
        && typeof value.buildFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.buildFingerprint)
        && (value.profile === undefined || typeof value.profile === 'string')
        && (value.chipId === undefined || typeof value.chipId === 'string' && /^esp32(?:[schp][0-9]+)?$/.test(value.chipId))
        && ['name', 'identity', 'mtimeNs', 'ctimeNs'].every(key => typeof elf[key] === 'string')
        && (elf.architecture === 'xtensa' || elf.architecture === 'riscv')
        && typeof elf.sha256 === 'string' && /^[a-f0-9]{64}$/.test(elf.sha256)
        && Number.isSafeInteger(elf.sizeBytes) && Number(elf.sizeBytes) >= 52 && Number(elf.sizeBytes) <= MAX_ELF_BYTES;
}

async function verifyBuild(target: ProjectInspection, signal: AbortSignal): Promise<{ record: BacktraceBuildRecord; markerHash: string; elfPath: string }> {
    canceled(signal);
    const scope = await inspectScope(target);
    let raw: Buffer;
    let marker: unknown;
    try {
        raw = (await readMetadata(path.join(target.buildPath, MARKER_NAME))).data;
        marker = JSON.parse(raw.toString('utf8'));
    } catch {
        throw new AiBridgeError('BUILD_REQUIRED', 'Compile this sketch and profile through the assistant first; its successful build record is unavailable.');
    }
    if (!isRecord(marker) || marker.result !== true || !isBuildRecord(marker.backtrace)) {
        throw new AiBridgeError('BUILD_REQUIRED', 'Compile this sketch and profile through the assistant first to record a matching ESP32 ELF.');
    }
    const record = marker.backtrace;
    if (record.buildFingerprint !== target.buildFingerprint || record.fqbn !== target.fqbn
        || record.profile !== target.resolvedProfile || !sameScope(record, scope)) {
        throw new AiBridgeError('STALE_BUILD', 'The saved build does not match the current sketch and profile. Compile the selected target through the assistant again.');
    }
    const elfPath = await selectElf(target);
    let elf: BacktraceBuildRecord['elf'];
    try { elf = await inspectElf(elfPath, signal); } catch (error) {
        if (error instanceof AiBridgeError) { throw error; }
        throw new AiBridgeError('STALE_BUILD', 'The matching ELF changed or became unreadable during inspection. Compile the selected target again.');
    }
    if (record.elf.name !== elf.name || record.elf.architecture !== elf.architecture || record.elf.sha256 !== elf.sha256
        || !sameStamp(record.elf, elf) || !sameScope(scope, await inspectScope(target))) {
        throw new AiBridgeError('STALE_BUILD', 'The matching ELF or build directory changed after compilation. Compile the selected target through the assistant again.');
    }
    return { record, elfPath, markerHash: createHash('sha256').update(raw).digest('hex') };
}

async function inspectTool(dataDir: string, toolPath: string): Promise<FileStamp> {
    const root = path.join(dataDir, 'packages', 'esp32', 'tools');
    const internal = path.join(dataDir, 'internal');
    const relative = path.relative(internal, toolPath).split(path.sep);
    const profileTool = within(internal, toolPath) && relative.length > 1 && isEsp32ProfileToolDirectory(relative[0]);
    if (!validPath(dataDir) || !validPath(toolPath) || !(within(root, toolPath) && !samePath(root, toolPath) || profileTool)) {
        throw new AiBridgeError('UNSAFE_DECODER', 'The decoder must belong to the installed ESP32 tools directory.');
    }
    try {
        let directory = path.dirname(toolPath);
        while (true) {
            await ordinaryDirectory(directory);
            if (samePath(directory, dataDir)) { break; }
            directory = path.dirname(directory);
            if (!within(dataDir, directory)) { throw new Error('Tool escaped package directory.'); }
        }
        return stamp(await ordinaryFile(toolPath));
    } catch {
        throw new AiBridgeError('UNSAFE_DECODER', 'The installed decoder path contains a link or changed during inspection.');
    }
}

/** Decode a pasted crash using only the exact successful build for this inspected sketch/profile. */
export async function decodeEsp32Backtrace(request: {
    target: ProjectInspection; log: string; dataDir: string; signal: AbortSignal; sensitiveValues?: readonly string[];
}): Promise<BacktraceDecodeResult> {
    const { target, log, dataDir, signal } = request;
    requireEsp32(target);
    if (typeof log !== 'string' || !log.trim() || log.includes('\0') || Buffer.byteLength(log, 'utf8') > MAX_BACKTRACE_LOG_BYTES) {
        throw new AiBridgeError('INVALID_ARGUMENT', 'Provide a nonempty ESP32 crash log within the supported text limit.');
    }
    canceled(signal);
    const extracted = extractBacktraceAddresses(log);
    const addresses = [...new Set([extracted.pc, ...extracted.addresses].filter((value): value is string => Boolean(value)))];
    if (!addresses.length) { throw new AiBridgeError('NO_BACKTRACE_ADDRESSES', 'The crash log contains no supported ESP32 Backtrace, PC, or MEPC instruction addresses.'); }
    const before = await verifyBuild(target, signal);
    const decoderPath = findAddr2LineBinary(dataDir, before.record.chipId ?? '', before.record.elf.architecture);
    if (!decoderPath) {
        throw new AiBridgeError('DECODER_NOT_FOUND', 'No matching addr2line decoder is installed in the Arduino ESP32 tools directory. Install the selected ESP32 board package in VS Code.');
    }
    const toolBefore = await inspectTool(dataDir, decoderPath);
    canceled(signal);
    const result = await runAddr2Line({ addr2linePath: decoderPath, elfPath: before.elfPath,
        addresses, signal, sensitiveValues: request.sensitiveValues });
    if (result.canceled || signal.aborted) { throw new AiBridgeError('CANCELED', 'Backtrace decoding was canceled.'); }
    if (result.error || result.exitCode !== 0) {
        throw new AiBridgeError('DECODER_FAILED', 'The installed addr2line decoder failed to decode the selected ELF. Check the ESP32 toolchain and compile this target again.');
    }
    const after = await verifyBuild(target, signal);
    if (before.markerHash !== after.markerHash || before.record.elf.sha256 !== after.record.elf.sha256
        || !sameStamp(toolBefore, await inspectTool(dataDir, decoderPath))) {
        throw new AiBridgeError('STALE_BUILD', 'The build or decoder changed during backtrace decoding. Compile the selected target again before retrying.');
    }
    canceled(signal);
    const frames: BacktraceDecodeFrame[] = [];
    const notes = ['This decodes the selected sketch/profile build. The extension cannot verify that this exact firmware is currently running on the device.'];
    let partial = result.truncated || extracted.truncated === true;
    for (const address of addresses) {
        const decoded = result.frames.filter(frame => frame.address === address);
        if (decoded.length) { frames.push(...decoded); } else {
            frames.push({ address, functionName: '??', file: '??', line: 0 });
            partial = true;
        }
    }
    if (frames.some(frame => frame.functionName === '??' || frame.file === '??' || frame.line <= 0)) {
        partial = true;
        notes.push('Some addresses have no source location or function symbol in this ELF; unknown frames were preserved.');
    }
    if (result.truncated) { notes.push('Decoder output exceeded its bounded size; some frames may be unavailable.'); }
    if (extracted.truncated) { notes.push('The crash log exceeded the address limit; only the first instruction addresses were decoded.'); }
    return { schemaVersion: 1, status: partial ? 'partial' : 'success',
        target: { sketchPath: target.sketchPath, ...(target.resolvedProfile ? { profile: target.resolvedProfile } : {}), fqbn: target.fqbn!, buildPath: target.buildPath },
        architecture: before.record.elf.architecture, elfPath: before.elfPath, decoderPath, frames,
        stdout: result.stdout, stderr: result.stderr, truncated: result.truncated || extracted.truncated === true, durationMs: result.durationMs, notes };
}
