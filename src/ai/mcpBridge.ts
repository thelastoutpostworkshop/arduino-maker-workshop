import { Readable, Writable } from 'node:stream';
import { AiBridgeError, AiToolName } from './contracts';
import { AiIpcClient, receiveLines, validateToolCall } from './ipcServer';
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
    get_project_context: 'Inspect the connected Arduino sketch, resolved profile, FQBN, build arguments, toolchain and issues without changing settings or opening hardware ports.',
    list_boards: 'List available Arduino boards using the connected VS Code toolchain. Does not select a board or install packages.',
    list_ports: 'Discover connected Arduino ports without opening a serial monitor, uploading, resetting or changing the selected port.',
    compile_sketch: 'Compile the connected Arduino sketch after explicit approval in VS Code. Runs board-package build tools and may download profile dependencies. Does not upload firmware or open a serial monitor.'
};

/** The complete intentionally small MCP surface. No generic command or upload tool exists. */
export function getMcpTools(includeDiscovery = false): unknown[] {
    const tools: unknown[] = (Object.keys(descriptions) as AiToolName[]).map(name => ({
        name,
        description: descriptions[name],
        inputSchema: {
            type: 'object',
            properties: {
                sketchPath: { type: 'string', description: 'Absolute path of the sketch connected by the user in VS Code.', minLength: 1, maxLength: 32768 },
                profile: { type: 'string', description: 'Optional existing sketch.yaml profile name.', minLength: 1, maxLength: 256 },
                ...(name === 'compile_sketch' ? { clean: { type: 'boolean', description: 'Clean this sketch/profile build output before compiling.', default: false } } : {})
            },
            required: ['sketchPath'],
            additionalProperties: false
        },
        annotations: {
            title: name === 'compile_sketch' ? 'Compile Arduino Sketch' : name === 'get_project_context' ? 'Inspect Arduino Project' : name === 'list_boards' ? 'List Arduino Boards' : 'List Arduino Ports',
            readOnlyHint: name !== 'compile_sketch',
            destructiveHint: name === 'compile_sketch',
            idempotentHint: name !== 'compile_sketch',
            openWorldHint: name === 'compile_sketch'
        }
    }));
    if (includeDiscovery) {
        tools.unshift({
            name: 'list_connected_sketches',
            description: 'List Arduino sketches explicitly connected to AI assistants in running VS Code windows. Call this first and use the selected sketchPath in other tools. A sessionCount above one means extra windows must disconnect before operating on that sketch.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { title: 'List Connected Arduino Sketches', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        });
    }
    return tools;
}

/** Newline-delimited JSON-RPC over stdio; input close immediately revokes pending operations. */
export async function runMcpBridge(input: Readable, output: Writable, session: string | AiSessionResolver): Promise<void> {
    const connection = typeof session === 'string' ? await AiIpcClient.connect(session) : session;
    const resolver = connection instanceof AiSessionResolver ? connection : undefined;
    const globalConnection = resolver !== undefined && resolver.sketchPath === undefined;
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
        connection.dispose();
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
                const instructions = globalConnection
                    ? 'Arduino Maker Workshop connects to explicitly enabled VS Code windows. Call list_connected_sketches first, then pass the selected absolute sketchPath to other tools. Use the project requested by the user; ask if the target is unclear. If none are listed, run Connect AI Assistant in VS Code. Compilation requires approval in the target window. Interrupted operations are never replayed. Upload, reset, erase and serial tools are unavailable.'
                    : `Connected sketch: ${connection.sketchPath}\nTools require an explicitly enabled session for this sketch in VS Code. If unavailable after a debug restart, run Connect AI Assistant again and retry. Compilation requires approval. Upload, reset, erase and serial monitor operations are unavailable.`;
                result(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'arduino-maker-workshop-local', version: '1.0.0' }, instructions });
                return;
            }
            case 'ping': result(id, {}); return;
            case 'tools/list':
                if (!initialized) { error(id, -32002, 'Client initialization is incomplete'); return; }
                if (params.cursor !== undefined) { error(id, -32602, 'This tool list does not use pagination'); return; }
                result(id, { tools: getMcpTools(globalConnection) });
                return;
            case 'tools/call': break;
            default: error(id, -32601, 'Method not found'); return;
        }
        if (!initialized) { error(id, -32002, 'Client initialization is incomplete'); return; }
        if (requests.size >= MAX_REQUESTS) { error(id, -32000, 'Too many active requests'); return; }
        let call: ReturnType<typeof validateToolCall> | { name: 'list_connected_sketches' };
        try {
            if (globalConnection && params.name === 'list_connected_sketches') {
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
                const sketches = await resolver!.listSketches();
                if (closed || controller.signal.aborted) { throw new AiBridgeError('CANCELED', 'The request was canceled.'); }
                return sketches;
            }
            const client = resolver ? await resolver.getClient(call.input.sketchPath) : connection as AiIpcClient;
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
    if (args.length === 2 && args[0] === '--session' && args[1]) {
        await runMcpBridge(process.stdin, process.stdout, args[1]);
        return;
    }
    if (args.length === 4 && args[0] === '--sketch' && args[1] && args[2] === '--session-dir' && args[3]) {
        const resolver = await AiSessionResolver.create(args[1], args[3]);
        await runMcpBridge(process.stdin, process.stdout, resolver);
        return;
    }
    throw new Error('Usage: node launcher.cjs --session-dir <session-directory>, or --sketch <sketch-path> --session-dir <session-directory>, or --session <session-file>');
}
