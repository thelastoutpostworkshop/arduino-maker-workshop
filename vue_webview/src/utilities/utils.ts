
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