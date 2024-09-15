/** @type {import('vite').UserConfig} */

export default ({
  build: {
    lib: {
      entry: "./src/extension.ts",
      formats: ["cjs"],
      fileName: "extension",
    },
    rollupOptions: {
      external: ["vscode"],
    },
    sourcemap: true,
    outDir: "build",
  },
  plugins: [],
});
