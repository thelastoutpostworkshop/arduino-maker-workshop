import { AiBridgeError, AiOperationResult, AiToolHandler, AiToolName, InspectionInput, OperationProgress, ProjectInspection } from './contracts';
import { collectSensitiveValues, redactForAssistant } from './redaction';

export interface AiOperationDependencies {
    isTrusted(): boolean;
    activeSketchPath(): string | undefined;
    isReady(): boolean;
    inspect(input: InspectionInput, activeSketchPath: string): ProjectInspection;
    cliInfo(): { executable: string; version: string };
    hasUnsavedSketchDocuments(sketchPath: string): boolean;
    revision(): number;
    compile(target: ProjectInspection, signal: AbortSignal, progress: (value: OperationProgress) => void): Promise<AiOperationResult>;
    discover(kind: 'boards' | 'ports', signal: AbortSignal): Promise<unknown>;
    invalidateBuild(target: ProjectInspection): void;
}

const allowedTools: readonly AiToolName[] = ['get_project_context', 'list_boards', 'list_ports', 'compile_sketch'];

/** Authorization is enforced here, independently of any client's tool annotations. */
export function createAiOperationHandler(dependencies: AiOperationDependencies): AiToolHandler {
    let compilePending = false;
    return async (name, input, signal, progress) => {
        const assertAvailable = () => {
            if (!allowedTools.includes(name)) {
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
        const activePath = dependencies.activeSketchPath();
        if (!activePath) {
            throw new AiBridgeError('NO_ACTIVE_SKETCH', 'Open and select a sketch folder in this VS Code window.');
        }
        const target = dependencies.inspect(input, activePath);
        const sensitiveValues = collectSensitiveValues(target.compileArgs);
        if (name === 'get_project_context') {
            return redactForAssistant({ ...target, cli: dependencies.cliInfo(), ready: dependencies.isReady() }, sensitiveValues);
        }
        if (!dependencies.isReady()) {
            throw new AiBridgeError('CLI_NOT_READY', 'Arduino CLI is not ready. Resolve its setup in Arduino Home and reconnect.');
        }
        if (name !== 'compile_sketch') {
            return redactForAssistant(await dependencies.discover(name === 'list_boards' ? 'boards' : 'ports', signal), sensitiveValues);
        }
        if (!target.canCompile) {
            throw new AiBridgeError('INVALID_TARGET', 'Resolve project context issues and select a valid board or profile before compiling.');
        }
        if (compilePending) {
            throw new AiBridgeError('BUSY', 'Another assistant compile is pending or running in this window.');
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
            const currentTarget = currentPath && dependencies.inspect(input, currentPath);
            if (!currentTarget || currentTarget.fingerprint !== target.fingerprint ||
                dependencies.revision() !== initialRevision || JSON.stringify(dependencies.cliInfo()) !== initialToolchain || dependencies.hasUnsavedSketchDocuments(target.sketchPath)) {
                throw new AiBridgeError('STALE_TARGET', 'The sketch or target changed before compilation. Request fresh context and retry.');
            }
            const result = await dependencies.compile(target, signal, progress);
            if (result.status === 'success') {
                let finalTarget: ProjectInspection | undefined;
                try {
                    const finalPath = dependencies.activeSketchPath();
                    finalTarget = finalPath ? dependencies.inspect(input, finalPath) : undefined;
                } catch { /* Invalid or removed inputs also make the successful artifact stale. */ }
                if (!finalTarget || finalTarget.fingerprint !== target.fingerprint || dependencies.revision() !== initialRevision || dependencies.hasUnsavedSketchDocuments(target.sketchPath) || JSON.stringify(dependencies.cliInfo()) !== initialToolchain || !dependencies.isTrusted() || signal.aborted) {
                    try { dependencies.invalidateBuild(target); } catch {
                        // Keep the failure result even when a changed output path cannot safely be written.
                    }
                    result.status = 'failed';
                    result.error = { code: 'STALE_INPUT', message: 'Inputs changed during compilation. Compile again before using the artifacts.' };
                    progress({ message: result.error.message });
                }
            }
            return redactForAssistant(result, sensitiveValues);
        } finally {
            compilePending = false;
        }
    };
}
