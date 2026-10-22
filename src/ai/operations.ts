import { AiBridgeError, AiDiscoveryQuery, AiOperationResult, AiToolHandler, InspectionInput, OperationProgress, ProjectInspection } from './contracts';
import { collectSensitiveValues, redactForAssistant } from './redaction';
import { buildDependencyReport } from './dependencies';
import { buildBoardDetails, buildLibrarySearch, buildExamples } from './discovery';
import { AI_TOOL_NAMES, validateToolCall } from './toolInputs';
import { unavailableCompileArtifacts } from './compileArtifacts';
import { unavailableCompileOutput } from './compileOutput';
import { unavailableCompileDependencies } from './compileDependencies';
import type { BacktraceDecodeResult } from './backtrace';

export interface AiOperationDependencies {
    isTrusted(): boolean;
    activeSketchPath(): string | undefined;
    isReady(): boolean;
    inspect(input: InspectionInput, activeSketchPath: string): ProjectInspection;
    cliInfo(): { executable: string; version: string };
    hasUnsavedSketchDocuments(sketchPath: string): boolean;
    revision(): number;
    compile(target: ProjectInspection, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<AiOperationResult>;
    decode(target: ProjectInspection, log: string, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<BacktraceDecodeResult>;
    discover(kind: 'boards' | 'ports' | 'cores' | 'libraries', signal: AbortSignal): Promise<unknown>;
    query(query: AiDiscoveryQuery, signal: AbortSignal): Promise<unknown>;
    invalidateBuild(target: ProjectInspection): void;
}

/** Authorization is enforced here, independently of any client's tool annotations. */
export function createAiOperationHandler(dependencies: AiOperationDependencies): AiToolHandler {
    let compilePending = false;
    let discoveryPending = false;
    return async (name, arguments_, signal, progress) => {
        const assertAvailable = () => {
            if (!AI_TOOL_NAMES.includes(name)) {
                throw new AiBridgeError('TOOL_NOT_ALLOWED', 'This operation is not available through the AI bridge.');
            }
            if (!dependencies.isTrusted()) {
                throw new AiBridgeError('WORKSPACE_UNTRUSTED', 'Trust this workspace in VS Code before using the AI bridge.');
            }
            if (signal.aborted) {
                throw new AiBridgeError('CANCELED', 'The request was canceled.');
            }
        };
        assertAvailable();
        const { input } = validateToolCall(name, arguments_);
        const activePath = dependencies.activeSketchPath();
        if (!activePath) {
            throw new AiBridgeError('NO_ACTIVE_SKETCH', 'Open and select a sketch folder in this VS Code window.');
        }
        const inspectionInput: InspectionInput = { sketchPath: input.sketchPath,
            ...(input.profile !== undefined ? { profile: input.profile } : {}),
            ...(input.clean !== undefined ? { clean: input.clean } : {}) };
        const target = dependencies.inspect(inspectionInput, activePath);
        const sensitiveValues = collectSensitiveValues(target.compileArgs);
        if (name === 'get_project_context') {
            return redactForAssistant({ ...target, cli: dependencies.cliInfo(), ready: dependencies.isReady() }, sensitiveValues);
        }
        if (!dependencies.isReady()) {
            throw new AiBridgeError('CLI_NOT_READY', 'Arduino CLI is not ready. Resolve its setup in Arduino Home and reconnect.');
        }
        if (name === 'decode_esp32_backtrace') {
            if (compilePending || discoveryPending) {
                throw new AiBridgeError('BUSY', 'Another assistant operation is pending or running in this window.');
            }
            if (!target.canCompile) {
                throw new AiBridgeError('INVALID_TARGET', 'Resolve the sketch board/profile and configuration issues before decoding.');
            }
            discoveryPending = true;
            try {
                const revision = dependencies.revision();
                const toolchain = JSON.stringify(dependencies.cliInfo());
                const assertCurrent = () => {
                    assertAvailable();
                    if (dependencies.hasUnsavedSketchDocuments(target.sketchPath)) {
                        throw new AiBridgeError('UNSAVED_DOCUMENTS', 'Save the sketch documents and use the matching build before decoding.');
                    }
                    const currentPath = dependencies.activeSketchPath();
                    let current: ProjectInspection | undefined;
                    try { current = currentPath ? dependencies.inspect(inspectionInput, currentPath) : undefined; } catch { /* Changed or removed inputs are stale. */ }
                    if (!current || current.fingerprint !== target.fingerprint || dependencies.revision() !== revision ||
                        JSON.stringify(dependencies.cliInfo()) !== toolchain) {
                        throw new AiBridgeError('STALE_INPUT', 'The sketch or toolchain changed during decoding. Use the matching build and request decoding again.');
                    }
                };
                progress({ message: 'Checking the matching ESP32 build...' });
                assertCurrent();
                const result = await dependencies.decode(target, input.log!, signal, progress);
                assertCurrent();
                return redactForAssistant(result, sensitiveValues);
            } finally { discoveryPending = false; }
        }
        if (name !== 'compile_sketch') {
            if (compilePending || discoveryPending) {
                throw new AiBridgeError('BUSY', 'Another assistant CLI operation is pending or running in this window.');
            }
            discoveryPending = true;
            try {
                let discovered: unknown;
                if (name === 'list_dependencies') {
                    // Inventory initialization must finish before the next query starts.
                    const cores = await dependencies.discover('cores', signal);
                    assertAvailable();
                    const libraries = await dependencies.discover('libraries', signal);
                    assertAvailable();
                    discovered = buildDependencyReport(target, cores, libraries);
                } else if (name === 'list_boards' || name === 'list_ports') {
                    discovered = await dependencies.discover(name === 'list_boards' ? 'boards' : 'ports', signal);
                } else {
                    const source = input.source ?? 'all';
                    const needsBoard = name === 'get_board_details' || (name === 'list_examples' && source !== 'libraries');
                    if (needsBoard && (!target.fqbn || target.issues.some(issue => [
                        'FQBN_REQUIRED', 'INVALID_FQBN', 'PROFILE_REQUIRED', 'PROFILE_NOT_FOUND', 'INVALID_PROFILE',
                        'INVALID_PROFILES', 'INVALID_CONFIGURATION', 'INVALID_YAML', 'INVALID_METADATA', 'METADATA_UNREADABLE',
                    ].includes(issue.code)))) {
                        throw new AiBridgeError('INVALID_TARGET', 'Select a valid board or profile before requesting board details or board examples.');
                    }
                    const query: AiDiscoveryQuery = name === 'get_board_details'
                        ? { kind: 'boardDetails', sketchPath: target.sketchPath, fqbn: target.fqbn!.split(':').slice(0, 3).join(':') }
                        : name === 'search_libraries'
                            ? { kind: 'librarySearch', sketchPath: target.sketchPath, query: input.query! }
                            : { kind: 'examples', sketchPath: target.sketchPath, ...(needsBoard ? { fqbn: target.fqbn } : {}) };
                    const raw = await dependencies.query(query, signal);
                    assertAvailable();
                    const currentPath = dependencies.activeSketchPath();
                    if (currentPath !== activePath) {
                        throw new AiBridgeError('STALE_TARGET', 'The active sketch changed during discovery. Request fresh context and retry.');
                    }
                    const current = dependencies.inspect(inspectionInput, currentPath);
                    if (current.fqbn !== target.fqbn || current.resolvedProfile !== target.resolvedProfile || current.sketchPath !== target.sketchPath) {
                        throw new AiBridgeError('STALE_TARGET', 'The board or profile changed during discovery. Request fresh context and retry.');
                    }
                    discovered = name === 'get_board_details' ? buildBoardDetails(target, raw)
                        : name === 'search_libraries' ? buildLibrarySearch(target, input.query!, input.limit ?? 20, raw)
                            : buildExamples(target, { source, library: input.library, limit: input.limit ?? 50 }, raw);
                }
                assertAvailable();
                return redactForAssistant(discovered, sensitiveValues);
            } finally { discoveryPending = false; }
        }
        if (!target.canCompile) {
            throw new AiBridgeError('INVALID_TARGET', 'Resolve project context issues and select a valid board or profile before compiling.');
        }
        if (compilePending || discoveryPending) {
            throw new AiBridgeError('BUSY', 'Another assistant CLI operation is pending or running in this window.');
        }
        compilePending = true;
        try {
            const initialRevision = dependencies.revision();
            const initialToolchain = JSON.stringify(dependencies.cliInfo());
            if (dependencies.hasUnsavedSketchDocuments(target.sketchPath)) {
                throw new AiBridgeError('UNSAVED_DOCUMENTS', 'Save the sketch documents in VS Code before compiling. Other files will not be saved.');
            }
            progress({ message: 'Preparing compilation...' });
            assertAvailable();
            const currentPath = dependencies.activeSketchPath();
            const currentTarget = currentPath && dependencies.inspect(inspectionInput, currentPath);
            if (!currentTarget || currentTarget.fingerprint !== target.fingerprint ||
                dependencies.revision() !== initialRevision || JSON.stringify(dependencies.cliInfo()) !== initialToolchain || dependencies.hasUnsavedSketchDocuments(target.sketchPath)) {
                throw new AiBridgeError('STALE_TARGET', 'The sketch or target changed before compilation. Request fresh context and retry.');
            }
            const result = await dependencies.compile(target, signal, progress);
            if (result.status === 'success') {
                let finalTarget: ProjectInspection | undefined;
                try {
                    const finalPath = dependencies.activeSketchPath();
                    finalTarget = finalPath ? dependencies.inspect(inspectionInput, finalPath) : undefined;
                } catch { /* Invalid or removed inputs also make the successful artifact stale. */ }
                if (!finalTarget || finalTarget.fingerprint !== target.fingerprint || dependencies.revision() !== initialRevision || dependencies.hasUnsavedSketchDocuments(target.sketchPath) || JSON.stringify(dependencies.cliInfo()) !== initialToolchain || !dependencies.isTrusted() || signal.aborted) {
                    try { dependencies.invalidateBuild(target); } catch {
                        // Keep the failure result even when a changed output path cannot safely be written.
                    }
                    result.status = 'failed';
                    result.error = { code: 'STALE_INPUT', message: 'Inputs changed during compilation. Compile again before using the artifacts.' };
                    result.memory = unavailableCompileOutput(result.error.message).memory;
                    result.dependencies = unavailableCompileDependencies(result.error.message);
                    progress({ message: result.error.message });
                }
            }
            if (result.status !== 'success') {
                result.artifacts = unavailableCompileArtifacts(result.error?.message ?? 'Artifacts are only reported after successful compilation.');
            }
            return redactForAssistant(result, sensitiveValues);
        } finally {
            compilePending = false;
        }
    };
}
