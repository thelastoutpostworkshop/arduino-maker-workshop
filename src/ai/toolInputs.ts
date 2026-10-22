import * as path from 'node:path';
import { AiBridgeError, type AiToolInput, type AiToolName } from './contracts';

export const AI_TOOL_NAMES: readonly AiToolName[] = [
    'get_project_context', 'list_dependencies', 'list_boards', 'list_ports',
    'get_board_details', 'search_libraries', 'list_examples', 'compile_sketch',
    'decode_esp32_backtrace',
    'install_library',
];

export const MAX_BACKTRACE_LOG_BYTES = 8192;
export const LIBRARY_INSTALL_NAME_PATTERN = '^ *[A-Za-z0-9][A-Za-z0-9 _.-]*$(?![\\s\\S])';
export const LIBRARY_INSTALL_VERSION_PATTERN = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$(?![\\s\\S])';

/** Validate one exact index dependency before either transport or CLI execution. */
export function validateLibraryInstall(library: unknown, version: unknown): { library: string; version: string } {
    if (typeof library !== 'string' || library.length > 256 ||
        !new RegExp(LIBRARY_INSTALL_NAME_PATTERN).test(library) ||
        typeof version !== 'string' || version.length > 64 || version !== version.trim() ||
        !new RegExp(LIBRARY_INSTALL_VERSION_PATTERN).test(version)) {
        throw new AiBridgeError('INVALID_ARGUMENTS', 'An exact indexed library name and version are required.');
    }
    return { library: library.trim(), version };
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validText(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 256 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
}

function validBacktraceLog(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 &&
        Buffer.byteLength(value, 'utf8') <= MAX_BACKTRACE_LOG_BYTES &&
        !/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/.test(value);
}

/** One allowlist and argument validator for both transports and operation execution. */
export function validateToolCall(name: unknown, input: unknown): { name: AiToolName; input: AiToolInput } {
    if (typeof name !== 'string' || !AI_TOOL_NAMES.includes(name as AiToolName)) {
        throw new AiBridgeError('UNKNOWN_TOOL', 'This operation is not available.');
    }
    if (!record(input) || typeof input.sketchPath !== 'string' || !path.isAbsolute(input.sketchPath) ||
        input.sketchPath.length > 32768 || /[\x00-\x1f\x7f]/.test(input.sketchPath)) {
        throw new AiBridgeError('INVALID_ARGUMENTS', 'An absolute sketchPath is required.');
    }
    const allowed = ['sketchPath', 'profile', ...(name === 'compile_sketch' ? ['clean'] :
        name === 'install_library' ? ['library', 'version'] :
        name === 'decode_esp32_backtrace' ? ['log'] :
        name === 'search_libraries' ? ['query', 'limit'] : name === 'list_examples' ? ['source', 'library', 'limit'] : [])];
    if (Object.keys(input).some(key => !allowed.includes(key)) ||
        (input.profile !== undefined && (typeof input.profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.profile))) ||
        (input.clean !== undefined && typeof input.clean !== 'boolean') ||
        (name === 'search_libraries' && !validText(input.query)) ||
        (name === 'decode_esp32_backtrace' && !validBacktraceLog(input.log)) ||
        (input.library !== undefined && !validText(input.library)) ||
        (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) ||
        (input.source !== undefined && !['board', 'libraries', 'all'].includes(input.source as string))) {
        throw new AiBridgeError('INVALID_ARGUMENTS', 'The operation arguments are invalid.');
    }
    const installation = name === 'install_library' ? validateLibraryInstall(input.library, input.version) : {};
    return {
        name: name as AiToolName,
        input: { ...input, ...(typeof input.query === 'string' ? { query: input.query.trim() } : {}),
            ...(typeof input.library === 'string' ? { library: input.library.trim() } : {}), ...installation } as unknown as AiToolInput,
    };
}
