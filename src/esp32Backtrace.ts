import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BacktraceDecodeFrame } from './shared/messages';
import { runProcess, type ProcessResult } from './ai/processRunner';

export type BacktraceArchitecture = 'xtensa' | 'riscv';
export const MAX_BACKTRACE_LOG_BYTES = 64 * 1024;
export const MAX_BACKTRACE_ADDRESSES = 128;
const MAX_DECODER_OUTPUT_BYTES = 128 * 1024;
const MAX_DECODED_FRAMES = MAX_BACKTRACE_ADDRESSES * 8;

function normalizeAddress(value: string): string | undefined {
    if (!/^0x[0-9a-f]{1,8}$/i.test(value)) { return undefined; }
    const address = Number.parseInt(value.slice(2), 16);
    return `0x${address.toString(16).padStart(8, '0')}`;
}

/** Extract instruction addresses only: stack-pointer halves and stack dumps are not frames. */
export function extractBacktraceAddresses(log: string): { addresses: string[]; pc?: string; truncated?: boolean } {
    const bytes = Buffer.from(log, 'utf8');
    const bounded = bytes.subarray(0, MAX_BACKTRACE_LOG_BYTES).toString('utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    let truncated = bytes.length > MAX_BACKTRACE_LOG_BYTES;
    const addresses: string[] = [];
    const seen = new Set<string>();
    let pc: string | undefined;
    let stackDump = false;
    for (const line of bounded.split(/\r?\n/)) {
        if (!pc) {
            const register = line.match(/(?:^|\s)(?:MEPC|PC)\s*[:=]?\s*(0x[0-9a-f]{1,8})(?![0-9a-f])/i);
            pc = register ? normalizeAddress(register[1]) : undefined;
        }
        const marker = line.match(/\bBacktrace\s*:\s*(.*)$/i);
        if (/\bStack memory\s*:/i.test(line)) { stackDump = true; }
        if (marker) { stackDump = false; }
        const text = marker ? marker[1] : line.trim();
        const onlyPairs = /^(?:0x[0-9a-f]{1,8}\s*:\s*0x[0-9a-f]{1,8}(?:\s+|$))+(?:\s*\|?\s*<-CORRUPTED)?$/i.test(text);
        // A lone PC:SP pair is also accepted when users paste only the trace.
        const useLine = Boolean(marker) || onlyPairs && !stackDump;
        if (!useLine) { continue; }
        const pairs = text.matchAll(/(?:^|\s)(0x[0-9a-f]{1,8})\s*:\s*(0x[0-9a-f]{1,8})(?![0-9a-f])/gi);
        for (const pair of pairs) {
            const address = normalizeAddress(pair[1]);
            if (address && !seen.has(address)) {
                if (addresses.length < MAX_BACKTRACE_ADDRESSES) {
                    seen.add(address);
                    addresses.push(address);
                } else { truncated = true; }
            }
        }
    }
    if (pc && !seen.has(pc) && addresses.length === MAX_BACKTRACE_ADDRESSES) {
        addresses.pop();
        truncated = true;
    }
    return { addresses, pc, ...(truncated ? { truncated: true } : {}) };
}

function frameAtLocation(functionName: string, location: string, address?: string): BacktraceDecodeFrame {
    const cleaned = location.trim().replace(/\s+\(discriminator \d+\)$/, '');
    const match = cleaned.match(/^(.*):([0-9]+|\?)(?::[0-9]+)?$/);
    return {
        address,
        functionName: functionName.trim() || '??',
        file: (match ? match[1] : cleaned) || '??',
        line: match && /^\d+$/.test(match[2]) ? Number.parseInt(match[2], 10) : 0,
    };
}

/** GNU pretty output includes one address per group, followed by optional inline callers. */
export function parseAddr2LineOutput(output: string): BacktraceDecodeFrame[] {
    return parseAddr2LineFrames(output, MAX_DECODED_FRAMES);
}

function parseAddr2LineFrames(output: string, maxFrames: number): BacktraceDecodeFrame[] {
    const frames: BacktraceDecodeFrame[] = [];
    const lines = output.slice(0, MAX_DECODER_OUTPUT_BYTES).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let currentAddress: string | undefined;
    for (let index = 0; index < lines.length && frames.length < maxFrames; index++) {
        let line = lines[index];
        const addressMatch = line.match(/^(0x[0-9a-f]+)(?::\s*|$)(.*)$/i);
        if (addressMatch) {
            // GNU binutils may print a 64-bit padded address for a 32-bit ELF.
            currentAddress = normalizeAddress(`0x${addressMatch[1].slice(2).replace(/^0+(?=[0-9a-f])/i, '')}`);
            line = addressMatch[2];
            if (!line) { continue; }
        }
        line = line.replace(/^\(inlined by\)\s*/, '');
        const atIndex = line.lastIndexOf(' at ');
        if (atIndex !== -1) {
            frames.push(frameAtLocation(line.slice(0, atIndex), line.slice(atIndex + 4), currentAddress));
        } else if (index + 1 < lines.length && /:(?:[0-9]+|\?)(?:\s+\(discriminator \d+\))?$/.test(lines[index + 1])) {
            frames.push(frameAtLocation(line, lines[++index], currentAddress));
        }
    }
    return frames;
}

export interface Addr2LineRequest {
    addr2linePath: string;
    elfPath: string;
    addresses: readonly string[];
    pc?: string;
    signal?: AbortSignal;
    sensitiveValues?: readonly string[];
}

/** Paths must be chosen by the caller; no shell, user flags, or commands are accepted. */
export async function runAddr2Line(request: Addr2LineRequest): Promise<ProcessResult & { frames: BacktraceDecodeFrame[] }> {
    const addresses = [...new Set([request.pc, ...request.addresses].filter((value): value is string => Boolean(value)))];
    if (addresses.length === 0 || addresses.length > MAX_BACKTRACE_ADDRESSES || addresses.some(value => !normalizeAddress(value))) {
        throw new Error('Provide between 1 and 128 valid 32-bit backtrace addresses.');
    }
    const result = await runProcess(request.addr2linePath, ['-a', '-f', '-C', '-i', '-p', '-e', request.elfPath, ...addresses], {
        signal: request.signal,
        maxOutputBytes: MAX_DECODER_OUTPUT_BYTES,
        sensitiveValues: request.sensitiveValues,
    });
    const frames = parseAddr2LineFrames(result.stdout, MAX_DECODED_FRAMES + 1);
    return { ...result, truncated: result.truncated || frames.length > MAX_DECODED_FRAMES, frames: frames.slice(0, MAX_DECODED_FRAMES) };
}

export function findNewestElfInFolder(folder: string, includeSubfolders = false): string | undefined {
    const candidates: { filePath: string; mtimeMs: number }[] = [];
    let visited = 0;
    const scan = (directory: string, depth: number) => {
        if (++visited > 4096 || fs.lstatSync(directory).isSymbolicLink()) { return; }
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (++visited > 4096) { return; }
            const filePath = path.join(directory, entry.name);
            if (entry.isDirectory() && includeSubfolders && depth < 2) { scan(filePath, depth + 1); }
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.elf')) {
                candidates.push({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs });
            }
        }
    };
    try { scan(folder, 0); } catch { return undefined; }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
    return candidates[0]?.filePath;
}

export function getDefaultArduinoDataDirectory(): string | undefined {
    const candidate = os.platform() === 'win32'
        ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Arduino15')
        : os.platform() === 'darwin' ? path.join(os.homedir(), 'Library', 'Arduino15')
            : os.platform() === 'linux' ? path.join(os.homedir(), '.arduino15') : undefined;
    return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

export function extractChipFromString(input: unknown): string | undefined {
    if (typeof input !== 'string') { return undefined; }
    const matches = [...input.toLowerCase().matchAll(/esp32(?:[-_]?([schp][0-9]+))?/g)];
    const specific = matches.find(match => match[1]);
    return specific ? `esp32${specific[1]}` : matches.length ? 'esp32' : undefined;
}

export function getChipIdFromBuildOptions(buildPath: string): string | undefined {
    try {
        const filename = path.join(buildPath, 'build.options.json');
        if (fs.statSync(filename).size > 1024 * 1024) { return undefined; }
        const options = JSON.parse(fs.readFileSync(filename, 'utf8'));
        for (const key of ['build.mcu', 'build.fqbn', 'build.fqbn_name', 'build.board', 'build.arch', 'build.core']) {
            const chip = extractChipFromString(options[key]);
            if (chip) { return chip; }
        }
    } catch { /* Optional build metadata may not exist yet. */ }
    return undefined;
}

export function resolveEsp32Arch(chipId: string): BacktraceArchitecture | undefined {
    if (['esp32c2', 'esp32c3', 'esp32c5', 'esp32c6', 'esp32c61', 'esp32h2', 'esp32p4'].includes(chipId.toLowerCase())) { return 'riscv'; }
    if (['esp32', 'esp32s2', 'esp32s3'].includes(chipId.toLowerCase())) { return 'xtensa'; }
    return undefined;
}

/** Arduino CLI stores isolated profile tool packages under data/internal/<sanitized tool UID>. */
export function isEsp32ProfileToolDirectory(name: string): boolean {
    return name.length <= 128 && /^esp32_(?:esp-(?:x32|xs2|xs3|rv32)|(?:xtensa-esp32(?:s2|s3)?|riscv32-esp)-elf(?:-gcc)?)_[a-z0-9.+_-]+_[a-f0-9]{8,16}$/i.test(name);
}

export function findAddr2LineBinary(dataDir: string, chipId: string, arch: BacktraceArchitecture): string | undefined {
    const roots = [path.join(dataDir, 'packages', 'esp32', 'tools')];
    const profileRoot = path.join(dataDir, 'internal');
    try {
        if (!fs.lstatSync(profileRoot).isSymbolicLink()) {
            for (const entry of fs.readdirSync(profileRoot, { withFileTypes: true }).slice(0, 4096)) {
                if (entry.isDirectory() && isEsp32ProfileToolDirectory(entry.name)) { roots.push(path.join(profileRoot, entry.name)); }
            }
        }
    } catch { /* The isolated profile cache is optional. */ }
    const suffix = os.platform() === 'win32' ? '.exe' : '';
    const candidates = arch === 'riscv' ? [`riscv32-esp-elf-addr2line${suffix}`]
        : [...new Set([...(chipId ? [`xtensa-${chipId}-elf-addr2line${suffix}`] : []), `xtensa-esp-elf-addr2line${suffix}`])];
    const matches: { filePath: string; mtimeMs: number; rank: number }[] = [];
    const stack: { directory: string; depth: number; realRoot: string }[] = [];
    for (const root of roots) {
        try {
            if (!fs.lstatSync(root).isSymbolicLink()) { stack.push({ directory: root, depth: 0, realRoot: fs.realpathSync(root) }); }
        } catch { /* The regular install or isolated profile cache may be absent. */ }
    }
    let visited = 0;
    while (stack.length && visited < 20000) {
        // Breadth first reaches bin directories before large compiler resource trees.
        const current = stack.shift()!;
        try {
            for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
                if (++visited > 20000) { break; }
                const filePath = path.join(current.directory, entry.name);
                if (entry.isDirectory() && current.depth < 5 && !['lib', 'libexec', 'include', 'share'].includes(entry.name.toLowerCase())) {
                    stack.push({ directory: filePath, depth: current.depth + 1, realRoot: current.realRoot });
                }
                else if (entry.isFile()) {
                    const rank = candidates.findIndex(name => name.toLowerCase() === entry.name.toLowerCase());
                    if (rank < 0) { continue; }
                    const realFile = fs.realpathSync(filePath);
                    const relative = path.relative(current.realRoot, realFile);
                    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) { continue; }
                    matches.push({ filePath: realFile, mtimeMs: fs.statSync(realFile).mtimeMs, rank });
                }
            }
        } catch { /* A tool package can disappear during board-manager updates. */ }
    }
    matches.sort((a, b) => a.rank - b.rank || b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
    return matches[0]?.filePath;
}
