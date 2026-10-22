// Best-effort credential redaction. Raw configuration and notes are never exported.
const credentialKey = /password|passwd|token|secret|api[_-]?key|auth/i;

interface SensitiveSpan { start: number; end: number; value: string; }

function keyCharacter(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z0-9_.-]/.test(character);
}

/** A deterministic scan avoids overlapping greedy regexes on long compiler lines. */
function sensitiveSpans(text: string): SensitiveSpan[] {
    const spans: SensitiveSpan[] = [];
    let index = 0;
    while (index < text.length) {
        if (!keyCharacter(text[index])) { index++; continue; }
        const keyStart = index;
        while (keyCharacter(text[index])) { index++; }
        const key = text.slice(keyStart, index);
        if (!credentialKey.test(key)) { continue; }
        let cursor = index;
        // Preserve quoted JSON property names as well as ordinary key=value flags.
        if ((text[cursor] === '"' || text[cursor] === "'") && text[keyStart - 1] === text[cursor]) { cursor++; }
        while (cursor < text.length && /\s/.test(text[cursor])) { cursor++; }
        if (text[cursor] !== '=' && text[cursor] !== ':') { continue; }
        cursor++;
        while (cursor < text.length && /\s/.test(text[cursor])) { cursor++; }
        const quote = text[cursor] === '"' || text[cursor] === "'" ? text[cursor++] : undefined;
        const start = cursor;
        if (quote) {
            while (cursor < text.length && text[cursor] !== quote && text[cursor] !== '\r' && text[cursor] !== '\n') {
                cursor += text[cursor] === '\\' && cursor + 1 < text.length ? 2 : 1;
            }
        } else {
            while (cursor < text.length && !/[\s,;"'\[\]{}\\]/.test(text[cursor])) { cursor++; }
        }
        if (cursor > start) {
            spans.push({ start, end: cursor, value: text.slice(start, cursor) });
            index = cursor;
        }
    }
    return spans;
}

export function collectSensitiveValues(args: readonly string[]): string[] {
    const values = new Set<string>();
    for (const arg of args) {
        for (const span of sensitiveSpans(arg)) {
            if (span.value !== '<redacted>') { values.add(span.value); }
        }
    }
    return [...values].sort((left, right) => right.length - left.length);
}

export function redactText(text: string, sensitiveValues: readonly string[] = []): string {
    const values = [...new Set(sensitiveValues.filter(Boolean))].sort((left, right) => right.length - left.length);
    // Unusual credential lists fail closed instead of expanding or monopolizing logs.
    if (values.length > 32 || values.reduce((total, value) => total + value.length, 0) > 4096) {
        return '[Output omitted: sensitive arguments exceed the redaction budget.]';
    }
    const literalPattern = values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const input = literalPattern ? text.replace(new RegExp(literalPattern, 'g'), () => '<redacted>') : text;
    const chunks: string[] = [];
    let previous = 0;
    for (const span of sensitiveSpans(input)) {
        chunks.push(input.slice(previous, span.start), '<redacted>');
        previous = span.end;
    }
    chunks.push(input.slice(previous));
    return chunks.join('');
}

export function redactForAssistant(value: unknown, sensitiveValues: readonly string[] = []): unknown {
    if (typeof value === 'string') {
        return redactText(value, sensitiveValues);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactForAssistant(item, sensitiveValues));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            credentialKey.test(key)
                ? '<redacted>' : redactForAssistant(item, sensitiveValues)
        ]));
    }
    return value;
}
