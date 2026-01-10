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
- `vue_webview/src/components/LibExamples.vue`: library examples UI (sorted list + sorted examples).
- `vue_webview/src/components/BoardExamples.vue`: board examples UI (sorted list + sorted examples).
- `src/cliOutputView.ts`: Arduino CLI Output webview panel (search/filter, colorized output).

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

## Board Examples
- Fetch path: `BoardExamples.vue` -> `ARDUINO_MESSAGES.CLI_BOARD_EXAMPLES` -> `VueWebviewPanel` -> `ArduinoCLI.searchBoardExamples()` -> `arduino-cli lib list --all`.
- Filtering happens in the extension (`src/cli.ts`), not the UI, so board/library caches stay separate.
- FQBN respects build profiles: `ArduinoCLI.getBoardFqbnForExamples()` selects profile FQBN when active and passes it to CLI args.
- UI label shows `library.container_platform` as "Examples from: ..."; `container_platform` is part of `Library` in `src/shared/messages.ts`.

## Library Examples
- Uses `cli_libraryInstalled` output; no server-side filtering.
- UI sorts libraries and example lists alphabetically.

## Ports and Profiles
- Home upload port is disabled when build profiles are active (profiles manage port).
- Port selection sync is debounced to avoid overriding user choices during refresh; monitor port is kept in sync with upload port in `ArduinoProject.setPort`.

## Build Invalidation
- Build invalidation happens on editor changes and filesystem changes (including git pulls) via file watchers in `src/extension.ts`.
- Upload checks build freshness: `ArduinoProject.isUploadReady()` compares `compile_result.json` mtime to latest source mtime.

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
