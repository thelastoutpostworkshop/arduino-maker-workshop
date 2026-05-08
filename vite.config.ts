/** @type {import('vite').UserConfig} */

import { builtinModules } from "node:module";

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default ({
  build: {
    lib: {
      entry: "./src/extension.ts",
      formats: ["cjs"],
      fileName: "extension",
    },
    rollupOptions: {
      external: ["vscode", ...nodeBuiltins],
    },
    sourcemap: true,
    outDir: "build",
  },
  plugins: [],
});
