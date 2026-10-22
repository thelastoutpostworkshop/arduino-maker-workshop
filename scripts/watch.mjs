import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const watchers = [];
let stopping = false;

async function stop() {
    stopping = true;
    await Promise.all(watchers.splice(0).map(watcher => watcher.close()));
}

function reportError(error) {
    console.error(error);
    process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void stop().catch(reportError); });
}

try {
    for (const config of ['vite.config.ts', 'vite.ai.config.ts']) {
        const watcher = await build({
            root,
            configFile: fileURLToPath(new URL(`../${config}`, import.meta.url)),
            // Both independent bundles share build/. Neither watcher may clear it.
            build: { watch: {}, emptyOutDir: false },
        });
        if (stopping) {
            await watcher.close();
            break;
        }
        watchers.push(watcher);
    }
} catch (error) {
    reportError(error);
    await stop();
}
