import * as path from 'node:path';
import { AiBridgeError, type AiToolInput, type AiToolName } from './contracts';

export const AI_TOOL_NAMES: readonly AiToolName[] = [
    'get_project_context', 'list_dependencies', 'list_boards', 'list_ports',
    'get_board_details', 'search_libraries', 'list_examples', 'compile_sketch',
];

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validText(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 256 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
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
        name === 'search_libraries' ? ['query', 'limit'] : name === 'list_examples' ? ['source', 'library', 'limit'] : [])];
    if (Object.keys(input).some(key => !allowed.includes(key)) ||
        (input.profile !== undefined && (typeof input.profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.profile))) ||
        (input.clean !== undefined && typeof input.clean !== 'boolean') ||
        (name === 'search_libraries' && !validText(input.query)) ||
        (input.library !== undefined && !validText(input.library)) ||
        (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) ||
        (input.source !== undefined && !['board', 'libraries', 'all'].includes(input.source as string))) {
        throw new AiBridgeError('INVALID_ARGUMENTS', 'The operation arguments are invalid.');
    }
    return {
        name: name as AiToolName,
        input: { ...input, ...(typeof input.query === 'string' ? { query: input.query.trim() } : {}),
            ...(typeof input.library === 'string' ? { library: input.library.trim() } : {}) } as unknown as AiToolInput,
    };
}
