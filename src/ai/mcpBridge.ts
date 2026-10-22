import { Readable, Writable } from 'node:stream';
import { AiBridgeError, AiToolName } from './contracts';
import { receiveLines, validateToolCall } from './ipcServer';
import { AiSessionResolver } from './sessionDiscovery';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const MAX_LINE_BYTES = 64 * 1024;
// A result is represented both as structured JSON and as escaped text for older clients.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_REQUESTS = 16;

type RequestId = string | number | null;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is RequestId {
    return value === null || (typeof value === 'string' && value.length <= 128) ||
        (typeof value === 'number' && Number.isSafeInteger(value));
}

const descriptions: Record<AiToolName, string> = {
    get_project_context: 'Inspect the connected Arduino sketch, available profiles and declared dependencies, resolved profile, FQBN, build arguments, toolchain and issues without changing settings or opening hardware ports.',
    list_dependencies: 'List standard Arduino CLI core/library installations and compare with the selected profile declarations. Does not inspect isolated profile caches or resolve build dependencies. CLI initialization may download indexes and built-in tools; does not explicitly install declared cores/libraries, compile or change project settings.',
    list_boards: 'List available Arduino boards using the connected VS Code toolchain. Does not select a board or install packages.',
    list_ports: 'Discover connected Arduino ports without opening a serial monitor, uploading, resetting or changing the selected port.',
    get_board_details: 'Show the requested sketch/profile board, valid option values, defaults and current choices from its standard installed platform. Does not change board settings or install platforms. CLI initialization may download indexes and built-in tools.',
    search_libraries: 'Search the Arduino library index and return bounded results with available versions. May refresh the library index; does not install libraries or change profile declarations.',
    list_examples: 'List example locations from the selected board platform and/or standard installed libraries. Supports an exact library-name filter. Does not read, open, copy or run examples, install dependencies, or inspect isolated profile caches. CLI initialization may download indexes and built-in tools.',
    compile_sketch: 'Compile the connected Arduino sketch automatically while AI integration is enabled in its trusted VS Code window. Runs board-package build tools and may download profile dependencies. Does not upload firmware or open a serial monitor.'
};

const titles: Record<AiToolName, string> = {
    get_project_context: 'Inspect Arduino Project', list_dependencies: 'List Arduino Dependencies',
    list_boards: 'List Arduino Boards', list_ports: 'List Arduino Ports', compile_sketch: 'Compile Arduino Sketch',
    get_board_details: 'Inspect Arduino Board Options', search_libraries: 'Search Arduino Libraries', list_examples: 'List Arduino Examples',
};

const initializingTools: readonly AiToolName[] = ['compile_sketch', 'list_dependencies', 'get_board_details', 'search_libraries', 'list_examples'];

/** The complete intentionally small MCP surface. No generic command or upload tool exists. */
export function getMcpTools(): unknown[] {
    const tools: unknown[] = (Object.keys(descriptions) as AiToolName[]).map(name => ({
        name,
        description: descriptions[name],
        inputSchema: {
            type: 'object',
            properties: {
                sketchPath: { type: 'string', description: 'Absolute path of the sketch connected by the user in VS Code.', minLength: 1, maxLength: 32768 },
                profile: { type: 'string', description: 'Optional existing sketch.yaml profile name.', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' },
                ...(name === 'compile_sketch' ? { clean: { type: 'boolean', description: 'Clean this sketch/profile build output before compiling.', default: false } } : {}),
                ...(name === 'search_libraries' ? {
                    query: { type: 'string', description: 'Library name or search terms for the Arduino index.', minLength: 1, maxLength: 256 },
                    limit: { type: 'integer', description: 'Maximum libraries to return.', minimum: 1, maximum: 100, default: 20 },
                } : {}),
                ...(name === 'list_examples' ? {
                    source: { type: 'string', description: 'Board platform examples, installed library examples, or both. Board/all require a selected board or valid profile.', enum: ['board', 'libraries', 'all'], default: 'all' },
                    library: { type: 'string', description: 'Optional exact installed library name.', minLength: 1, maxLength: 256 },
                    limit: { type: 'integer', description: 'Maximum examples to return.', minimum: 1, maximum: 100, default: 50 },
                } : {})
            },
            required: name === 'search_libraries' ? ['sketchPath', 'query'] : ['sketchPath'],
            additionalProperties: false
        },
        annotations: {
            title: titles[name],
            // Inventory queries may initialize CLI indexes and built-in tools.
            readOnlyHint: !initializingTools.includes(name),
            destructiveHint: name === 'compile_sketch',
            idempotentHint: !initializingTools.includes(name),
            openWorldHint: initializingTools.includes(name)
        }
    }));
    tools.unshift({
        name: 'list_connected_sketches',
        description: 'List Arduino sketches available through enabled AI integration in running VS Code windows. Call this first and use the selected sketchPath in other tools. A sessionCount above one means extra windows for that sketch must close before operating on it.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { title: 'List Connected Arduino Sketches', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    });
    return tools;
}

/** Newline-delimited JSON-RPC over stdio; input close immediately revokes pending operations. */
export async function runMcpBridge(input: Readable, output: Writable, resolver: AiSessionResolver): Promise<void> {
    const requests = new Map<string, AbortController>();
    let initialized = false;
    let initializationRequested = false;
    let closed = false;
    let queuedBytes = 0;
    let stopLines: (() => void) | undefined;
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });

    const close = () => {
        if (closed) { return; }
        closed = true;
        stopLines?.();
        for (const controller of requests.values()) { controller.abort(); }
        requests.clear();
        resolver.dispose();
        input.removeListener('end', close);
        input.removeListener('close', close);
        input.removeListener('error', close);
        output.removeListener('close', close);
        // Closing only the IPC client leaves resumed stdin keeping the launcher alive.
        input.destroy();
        // End stdout gracefully so a queued terminal error reaches the MCP client.
        // Keep its error listener so failed pipe writes cannot escape during shutdown.
        if (output.destroyed || output.writableFinished) { finish(); }
        else {
            output.once('finish', finish);
            output.once('close', finish);
            output.once('error', finish);
            try { output.end(); } catch { finish(); }
        }
    };
    const send = (value: unknown) => {
        if (closed) { return; }
        let line: string;
        try { line = JSON.stringify(value) + '\n'; } catch { close(); return; }
        const bytes = Buffer.byteLength(line);
        if (bytes > MAX_OUTPUT_BYTES || queuedBytes + bytes > MAX_OUTPUT_BYTES * 2) { close(); return; }
        queuedBytes += bytes;
        try { output.write(line, error => { queuedBytes -= bytes; if (error) { close(); } }); }
        catch { close(); }
    };
    const error = (id: RequestId, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });
    const result = (id: RequestId, value: unknown) => send({ jsonrpc: '2.0', id, result: value });

    input.once('end', close);
    input.once('close', close);
    input.once('error', close);
    output.once('close', close);
    output.on('error', close);
    stopLines = receiveLines(input, MAX_LINE_BYTES, raw => {
        if (closed) { return; }
        let request: unknown;
        try { request = JSON.parse(raw); } catch { error(null, -32700, 'Parse error'); return; }
        if (!record(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || request.method.length > 256 ||
            ('id' in request && !validId(request.id)) || ('params' in request && !record(request.params))) {
            error(null, -32600, 'Invalid Request');
            return;
        }
        const params = record(request.params) ? request.params : {};
        if (!('id' in request)) {
            if (request.method === 'notifications/initialized' && initializationRequested) { initialized = true; }
            if (request.method === 'notifications/cancelled' && validId(params.requestId)) { requests.get(JSON.stringify(params.requestId))?.abort(); }
            return;
        }
        const id = request.id as RequestId;
        const key = JSON.stringify(id);
        if (requests.has(key)) { error(id, -32600, 'Duplicate active request ID'); return; }
        switch (request.method) {
            case 'initialize': {
                if (initializationRequested) { error(id, -32600, 'Already initialized'); return; }
                if (typeof params.protocolVersion !== 'string' || !record(params.capabilities) || !record(params.clientInfo) ||
                    typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
                    error(id, -32602, 'Invalid initialize parameters');
                    return;
                }
                initializationRequested = true;
                const version = PROTOCOL_VERSIONS.find(value => value === params.protocolVersion) ?? PROTOCOL_VERSIONS[0];
                const instructions = 'Arduino Maker Workshop connects to enabled, trusted VS Code sketch windows. Call list_connected_sketches first, then pass the selected absolute sketchPath to other tools. Use the project requested by the user; ask if the target is unclear. If none are listed, enable AI integration in VS Code. AI operations run without extension approval dialogs. Interrupted operations are never replayed. Upload, reset, erase and serial tools are unavailable.';
                result(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'arduino-maker-workshop-local', version: '1.0.0' }, instructions });
                return;
            }
            case 'ping': result(id, {}); return;
            case 'tools/list':
                if (!initialized) { error(id, -32002, 'Client initialization is incomplete'); return; }
                if (params.cursor !== undefined) { error(id, -32602, 'This tool list does not use pagination'); return; }
                result(id, { tools: getMcpTools() });
                return;
            case 'tools/call': break;
            default: error(id, -32601, 'Method not found'); return;
        }
        if (!initialized) { error(id, -32002, 'Client initialization is incomplete'); return; }
        if (requests.size >= MAX_REQUESTS) { error(id, -32000, 'Too many active requests'); return; }
        let call: ReturnType<typeof validateToolCall> | { name: 'list_connected_sketches' };
        try {
            if (params.name === 'list_connected_sketches') {
                if (params.arguments !== undefined && (!record(params.arguments) || Object.keys(params.arguments).length > 0)) {
                    throw new AiBridgeError('INVALID_ARGUMENTS', 'This tool accepts no arguments.');
                }
                call = { name: 'list_connected_sketches' };
            } else { call = validateToolCall(params.name, params.arguments); }
        }
        catch { error(id, -32602, 'Unknown tool or invalid arguments'); return; }
        const meta = params._meta;
        const progressToken = record(meta) ? meta.progressToken : undefined;
        if (progressToken !== undefined && (typeof progressToken !== 'string' && typeof progressToken !== 'number')) {
            error(id, -32602, 'Invalid progress token'); return;
        }
        if ((typeof progressToken === 'string' && progressToken.length > 128) || (typeof progressToken === 'number' && !Number.isFinite(progressToken))) {
            error(id, -32602, 'Invalid progress token'); return;
        }
        const controller = new AbortController();
        requests.set(key, controller);
        let progress = 0;
        void (async () => {
            if (call.name === 'list_connected_sketches') {
                const sketches = await resolver.listSketches();
                if (closed || controller.signal.aborted) { throw new AiBridgeError('CANCELED', 'The request was canceled.'); }
                return sketches;
            }
            const client = await resolver.getClient(call.input.sketchPath);
            if (closed || controller.signal.aborted) { throw new AiBridgeError('CANCELED', 'The request was canceled.'); }
            // Reconnect only before a new call. Never replay a tool after its IPC call starts.
            return client.call(call.name, call.input, controller.signal, value => {
                if (progressToken !== undefined && !controller.signal.aborted) {
                    send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: ++progress, message: value.message } });
                }
            });
        })().then(value => {
            const structuredContent = record(value) ? value : { result: value };
            result(id, { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: typeof structuredContent.status === 'string' && structuredContent.status !== 'success' });
        }).catch(failure => {
            if (controller.signal.aborted) { error(id, -32800, 'Request canceled'); return; }
            const issue = failure instanceof AiBridgeError ? { code: failure.code, message: failure.message } : { code: 'INTERNAL_ERROR', message: 'The bridge operation failed.' };
            const structuredContent = { schemaVersion: 1, error: issue };
            result(id, { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: true });
        }).finally(() => requests.delete(key));
    }, () => { error(null, -32600, 'Request exceeds the bridge size limit'); close(); });
    if (input.readableEnded || input.destroyed) { close(); }
    await completion;
}

/** Dedicated bundled entry calls this function; importing this module never starts a session. */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
    if (args.length === 2 && args[0] === '--session-dir' && args[1]) {
        const resolver = await AiSessionResolver.createGlobal(args[1]);
        await runMcpBridge(process.stdin, process.stdout, resolver);
        return;
    }
    throw new Error('Usage: launcher.cjs --session-dir <session-directory>');
}
