export interface ArduinoDebugInfo {
    executable?: string;
    toolchain?: string;
    toolchain_path?: string;
    toolchain_prefix?: string;
    server?: string;
    server_path?: string;
    server_configuration?: {
        scripts?: string[];
    };
    svd_file?: string;
    custom_configs?: {
        'cortex-debug'?: Record<string, unknown>;
    };
}

export interface CortexDebugConfiguration extends Record<string, unknown> {
    configId: string;
    name: string;
    type: 'cortex-debug';
    request: 'launch';
    executable: string;
}

export function createCortexDebugConfiguration(
    debugInfo: ArduinoDebugInfo,
    fqbn: string,
    programmer: string
): CortexDebugConfiguration {
    if (!debugInfo.executable || !debugInfo.server || !debugInfo.server_path) {
        throw new Error('Arduino CLI did not return the executable and debug server information required by Cortex-Debug.');
    }

    const configuration: CortexDebugConfiguration = {
        ...(debugInfo.custom_configs?.['cortex-debug'] ?? {}),
        configId: `${fqbn}:programmer=${programmer}`,
        name: `Arduino: ${fqbn} (${programmer})`,
        cwd: '${workspaceFolder}',
        request: 'launch',
        type: 'cortex-debug',
        executable: debugInfo.executable,
        servertype: debugInfo.server,
        serverpath: debugInfo.server_path,
    };

    if (debugInfo.toolchain_prefix) {
        configuration.toolchainPrefix = debugInfo.toolchain_prefix;
    }
    if (debugInfo.toolchain_path) {
        configuration.armToolchainPath = debugInfo.toolchain_path;
    }
    if (debugInfo.server_configuration?.scripts?.length) {
        configuration.configFiles = debugInfo.server_configuration.scripts;
    }
    if (debugInfo.svd_file) {
        configuration.svdFile = debugInfo.svd_file;
    }
    return configuration;
}

export function mergeCortexDebugConfiguration(existing: unknown, configuration: CortexDebugConfiguration): Record<string, unknown> {
    if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing))) {
        throw new Error('Existing launch.json must contain a JSON object.');
    }
    const launch = { ...(existing as Record<string, unknown> | undefined) };
    const configurations = launch.configurations;
    if (configurations !== undefined && !Array.isArray(configurations)) {
        throw new Error('Existing launch.json has an invalid configurations property.');
    }

    const entries = (configurations ?? []) as unknown[];
    const index = entries.findIndex((entry) =>
        !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).configId === configuration.configId
    );
    if (index >= 0) {
        entries[index] = configuration;
    } else {
        entries.push(configuration);
    }

    launch.version = typeof launch.version === 'string' ? launch.version : '0.2.0';
    launch.configurations = entries;
    return launch;
}
