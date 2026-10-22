import type { CompileArtifactReport } from './compileArtifacts';
import type { CompileDiagnostics, CompileMemory } from './compileOutput';

/** Shared, transport-independent contracts for the local assistant bridge. */
export interface AiIssue {
    code: string;
    message: string;
}

export interface DeclaredPlatformDependency {
    id: string;
    version?: string;
    indexUrl?: string;
}

export type DeclaredLibraryDependency = {
    kind: 'index';
    name: string;
    version?: string;
    transitive?: boolean;
} | {
    kind: 'local';
    directory: string;
};

export interface DeclaredDependencies {
    platforms: DeclaredPlatformDependency[];
    libraries: DeclaredLibraryDependency[];
    issues: AiIssue[];
}

export interface ProjectProfileSummary {
    name: string;
    fqbn?: string;
    isDefault: boolean;
    isSelected: boolean;
    dependencies: DeclaredDependencies;
    issues: AiIssue[];
}

export interface ProjectInspection {
    schemaVersion: 1;
    sketchPath: string;
    sketchName: string;
    configurationPath: string;
    profilePath?: string;
    selectedProfile?: string;
    resolvedProfile?: string;
    defaultProfile?: string;
    availableProfiles: ProjectProfileSummary[];
    availableProfilesTruncated?: boolean;
    declaredDependencies: DeclaredDependencies;
    fqbn?: string;
    port?: string;
    protocol?: string;
    programmer?: string;
    buildPath: string;
    buildProperties: string[];
    compileArgs: string[];
    fingerprint: string;
    canCompile: boolean;
    issues: AiIssue[];
}

export interface InspectionInput {
    sketchPath: string;
    profile?: string;
    clean?: boolean;
}

export type ExampleSource = 'board' | 'libraries' | 'all';

export interface AiToolInput extends InspectionInput {
    query?: string;
    limit?: number;
    source?: ExampleSource;
    library?: string;
}

/** Fixed CLI queries constructed from validated inputs and inspected project targets. */
export type AiDiscoveryQuery =
    | { kind: 'boardDetails'; sketchPath: string; fqbn: string }
    | { kind: 'librarySearch'; sketchPath: string; query: string }
    | { kind: 'examples'; sketchPath: string; fqbn?: string };

export type OperationStatus = 'success' | 'failed' | 'canceled' | 'busy' | 'invalid';

export interface AiOperationResult {
    schemaVersion: 1;
    operationId: string;
    status: OperationStatus;
    target: ProjectInspection;
    exitCode: number | null;
    signal?: string | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
    durationMs: number;
    diagnostics: CompileDiagnostics;
    memory: CompileMemory;
    artifacts: CompileArtifactReport;
    error?: AiIssue;
}

export interface OperationProgress {
    message: string;
}

export type AiToolName = 'get_project_context' | 'list_boards' | 'list_ports' | 'list_dependencies' |
    'get_board_details' | 'search_libraries' | 'list_examples' | 'compile_sketch';

export type AiToolHandler = (
    name: AiToolName,
    input: AiToolInput,
    signal: AbortSignal,
    progress: (value: OperationProgress) => void
) => Promise<unknown>;

export class AiBridgeError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'AiBridgeError';
    }
}
