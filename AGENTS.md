# Arduino Maker Workshop - Agent Notes

## Overview
- VS Code extension with a Vue webview UI.
- Extension backend lives in `src/` and is compiled to `build/extension.js`.
- Webview app lives in `vue_webview/` and is built to `vue_webview/dist/`.

## Key Paths
- `src/extension.ts`: activation, commands, status bar, wiring.
- `src/VueWebviewPanel.ts`: webview creation + message handling.
- `src/shared/messages.ts`: shared types and `ARDUINO_MESSAGES` constants (source of truth).
- `src/ArduinoProject.ts`: project config persisted in `.vscode/arduino.json`.
- `src/cli.ts` / `src/cliArgs.ts`: arduino-cli integration and build path logic.
- `src/sketchProfileManager.ts`: `sketch.yaml` build profiles.
- `vue_webview/src/stores/useVsCodeStore.ts`: message dispatch + webview state.
- `vue_webview/src/components/OtherTools.vue`: external tools UI.

## Build/Run
- Extension build: `npm run compile` (produces `build/extension.js` via Vite).
- Webview build: `npm run build:vue` (produces `vue_webview/dist/`).
- Prepublish: `npm run vscode:prepublish` (builds both).
- Lint: `npm run lint`
- Tests: `npm run test`
- Avoid editing generated outputs in `build/` or `vue_webview/dist/`.

## Webview Messaging
- Webview -> extension: `useVsCodeStore.sendMessage()` posts `ARDUINO_MESSAGES`.
- Extension -> webview: `VueWebviewPanel.sendMessage()`.
- Any new message should be defined in `src/shared/messages.ts` and handled on both sides.

## Build Output + Profiles
- Default build output is `build/` at workspace root.
- With active profiles, build output is `build/build_<profile>`.
- `partitions.csv` is generated into the build output and used by the ESP32 Partition Builder URL.

## ESP32 Partition Builder URL
- Base URL is centralized in `ESP32_PARTITION_BUILDER_BASE_URL` (`src/shared/messages.ts`).
- `VueWebviewPanel` resolves `partitions.csv`, flash size, and builds the URL.
- Webview mock data should use the same base URL constant.

## Common Pitfalls
- If you add new settings or message types, update both the extension and webview.
- Keep ASCII when editing files unless the file already contains Unicode.
