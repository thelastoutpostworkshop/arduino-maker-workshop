export function isValidUrlRule(url: string) {
    if(!isValidUrl(url)) {
        return 'invalid URL';
    }
    return true;
}

export function isValidUrl(url: string): boolean {
    try {
        const validateURL = new URL(url);
        return validateURL.protocol === 'https:';
    }
    catch (e) {
        return false;
    }
}

export function getAvailablePorts(store: any) {
    const filtered = store.boardConnected?.detected_ports.map((detectedPort: any) => {
        return detectedPort.port.label ?? 'Unknown'; // Provide a default if label is undefined
    }) ?? [];
    return filtered;
}
