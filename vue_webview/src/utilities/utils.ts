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

export type PortOption = {
    title: string;
    value: string;
    label?: string;
    address?: string;
    protocol?: string;
};

export function getAvailablePorts(store: any): PortOption[] {
    const filtered = store.boardConnected?.detected_ports.map((detectedPort: any) => {
        const port = detectedPort?.port ?? {};
        const label = port.label ?? port.address ?? 'Unknown';
        const value = port.address ?? port.label ?? 'Unknown';
        return {
            title: label,
            value,
            label: port.label,
            address: port.address,
            protocol: port.protocol
        };
    }) ?? [];
    return filtered;
}

export function resolvePortValue(options: PortOption[], storedValue: string): string {
    if (!storedValue) {
        return "";
    }
    const match = options.find((option) =>
        option.value === storedValue
        || option.address === storedValue
        || option.label === storedValue
        || option.title === storedValue
    );
    return match ? match.value : storedValue;
}
