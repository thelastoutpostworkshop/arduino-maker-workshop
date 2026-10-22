interface AiCompileApprovalConfiguration {
    inspect(section: string): { globalValue?: unknown } | undefined;
}

/** Only an explicit user setting can remove the extension's compile dialog. */
export function requiresAiCompileConfirmation(configuration: AiCompileApprovalConfiguration): boolean {
    return configuration.inspect('ai.confirmCompile')?.globalValue !== false;
}

export async function confirmAiCompilation(
    configuration: AiCompileApprovalConfiguration,
    trusted: boolean,
    prompt: () => Promise<boolean>,
): Promise<boolean> {
    if (!trusted) { return false; }
    return requiresAiCompileConfirmation(configuration) ? prompt() : true;
}
