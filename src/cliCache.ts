const path = require('path');
const fs = require('fs');

interface CacheMetadata {
    timestamp: number;
    ttl: number; // Time-to-live in milliseconds
}

export class CliCache {
    private cacheDirectory: string;

    constructor(cacheDirectory: string) {
        this.cacheDirectory = cacheDirectory;

        if (!fs.existsSync(this.cacheDirectory)) {
            fs.mkdirSync(this.cacheDirectory, { recursive: true });
        }
    }

    /**
     * Get cached data for a specific key if it exists and is valid.
     */
    public get(key: string): any | undefined {
        const cacheFilePath = this.getCacheFilePath(key);

        if (fs.existsSync(cacheFilePath)) {
            try {
                const metadataPath = this.getMetadataFilePath(key);
                const metadata: CacheMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

                // Check if the cache is still valid
                if (Date.now() - metadata.timestamp < metadata.ttl) {
                    const data = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
                    return data;
                } else {
                    // Cache expired, delete files
                    this.delete(key);
                }
            } catch (error) {
                console.error(`Failed to read cache for key ${key}: ${error}`);
                this.delete(key);
            }
        }

        return undefined;
    }

    /**
     * Store data in the cache with a specified TTL.
     */
    public set(key: string, data: any, ttl: number): void {
        const cacheFilePath = this.getCacheFilePath(key);
        const metadataPath = this.getMetadataFilePath(key);

        try {
            // Write the data to a file
            fs.writeFileSync(cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');

            // Write metadata to a separate file
            const metadata: CacheMetadata = {
                timestamp: Date.now(),
                ttl,
            };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        } catch (error) {
            console.error(`Failed to save cache for key ${key}: ${error}`);
        }
    }

    /**
     * Delete a specific cache entry.
     */
    public delete(key: string): void {
        const cacheFilePath = this.getCacheFilePath(key);
        const metadataPath = this.getMetadataFilePath(key);

        try {
            if (fs.existsSync(cacheFilePath)) {
                fs.unlinkSync(cacheFilePath);
            }
            if (fs.existsSync(metadataPath)) {
                fs.unlinkSync(metadataPath);
            }
        } catch (error) {
            console.error(`Failed to delete cache for key ${key}: ${error}`);
        }
    }

    /**
     * Clear the entire cache directory.
     */
    public clear(): void {
        try {
            fs.readdirSync(this.cacheDirectory).forEach((file:string) => {
                fs.unlinkSync(path.join(this.cacheDirectory, file));
            });
        } catch (error) {
            console.error(`Failed to clear cache: ${error}`);
        }
    }

    /**
     * Get the file path for the cache data.
     */
    private getCacheFilePath(key: string): string {
        const sanitizedKey = this.sanitizeKey(key);
        return path.join(this.cacheDirectory, `${sanitizedKey}.json`);
    }

    /**
     * Get the file path for the cache metadata.
     */
    private getMetadataFilePath(key: string): string {
        const sanitizedKey = this.sanitizeKey(key);
        return path.join(this.cacheDirectory, `${sanitizedKey}.meta.json`);
    }

    /**
     * Sanitize the key to create a valid filename.
     */
    private sanitizeKey(key: string): string {
        return key.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    }
}
