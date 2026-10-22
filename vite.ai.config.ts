import { builtinModules } from 'node:module';

// Build independently: the stable launcher must not depend on extension chunks.
export default {
    build: {
        lib: {
            entry: './src/ai/bridgeEntry.ts',
            formats: ['cjs'],
            fileName: () => 'aiBridge.cjs',
        },
        rollupOptions: { external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)] },
        outDir: 'build',
        emptyOutDir: false,
        sourcemap: true,
    },
};
