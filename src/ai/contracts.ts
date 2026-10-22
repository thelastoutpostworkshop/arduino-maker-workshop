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
    error?: AiIssue;
}

export interface OperationProgress {
    message: string;
}

export type AiToolName = 'get_project_context' | 'list_boards' | 'list_ports' | 'list_dependencies' | 'compile_sketch';

export type AiToolHandler = (
    name: AiToolName,
    input: InspectionInput,
    signal: AbortSignal,
    progress: (value: OperationProgress) => void
) => Promise<unknown>;

export class AiBridgeError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'AiBridgeError';
    }
}
