# MCP expansion TODO

Track the seven planned additions to the Arduino Maker Workshop AI bridge.
Complete each step with tests, user documentation, and a separate commit.

## Progress

- [x] 1. Project context and dependencies (completed)
- [x] 2. Board and library discovery (completed)
- [x] 3. Better compile results (completed)
- [ ] 4. ESP32 crash decoding (implemented; manual checks pending)
- [ ] 5. Library installation
- [ ] 6. Firmware upload
- [ ] 7. Serial capture

## Requirements for every step

- Keep changes scoped to the AI bridge and the extension services it needs.
- Do not introduce additional extension approval dialogs.
- Preserve workspace trust, explicit sketch targeting, cancellation, and operation concurrency checks.
- Keep tool inputs validated and results structured, bounded, and redacted.
- Keep existing MCP tools and manual extension workflows working.
- Leave the AI client's own tool approval preferences unchanged.
- Update the tool list, limitations, and [prompt examples](AI_ASSISTANTS.md#prompt-examples) whenever an MCP tool is added, changed, or removed.
- Keep a copyable prompt and an expected user-visible result for every available tool. State any example values to replace and prerequisites; keep future tools out of the user guide until implemented.
- Use these prompts for manual checks in an AI client. Track those checks separately from automated tests and leave them pending until actually performed.

## 1. Project context and dependencies

- [x] Extend `get_project_context` with available profiles and their declared dependencies.
- [x] Add `list_dependencies` for installed core/library versions and comparison with the selected profile's requirements.
- [x] Distinguish declared requirements, installed packages, and dependencies resolved by a build.
- [x] Test missing dependencies, version differences, and projects with and without profiles.
- [x] Update `AI_ASSISTANTS.md`.
- [x] Provide prompt examples with expected results for project context and dependency inspection.
- [x] Verify the project context and dependency prompts in an AI client (confirmed by the user).
- [x] Commit this step (`e016af2`).

Suggested commit: `Expose MCP profiles and dependencies`

## 2. Board and library discovery

- [x] Add `get_board_details` with valid board options and defaults.
- [x] Add `search_libraries` with bounded search results and available versions.
- [x] Add `list_examples` for the selected board and installed libraries.
- [x] Test profile-specific boards, empty results, invalid inputs, and result limits.
- [x] Add prompt examples with expected results and update `AI_ASSISTANTS.md`.
- [x] Verify the board details, library search, and example prompts in an AI client (confirmed by the user).
- [x] Commit this step (`01ff544`).

Suggested commit: `Add MCP board and library discovery`

## 3. Better compile results

- [x] Extend `compile_sketch` results with structured errors and warnings, including source locations when available.
- [x] Include flash/RAM usage and build artifact paths when available.
- [x] Include libraries and board platforms reported by the compilation, with available versions and installation paths.
- [x] Include the known Arduino CLI version with each compile result.
- [x] Preserve existing logs and report when structured details are unavailable.
- [x] Test successful and failed builds, different output formats, truncation, and stale artifacts (256 AI bridge tests passing).
- [x] Update the compilation prompts and expected results in `AI_ASSISTANTS.md`, including unavailable details and artifact freshness limits.
- [x] Test used dependencies across output formats, missing versions, profile installation paths, failed builds, and truncation; update the dependency prompt and limitations.
- [x] Verify the compilation prompts in an AI client, including memory usage, source locations on a failed build, and clean-build artifact paths (confirmed by the user).
- [x] Verify the used-dependencies prompt in an AI client against Arduino CLI Output, including a verbose profile build, unavailable details without verbose output, and the CLI version (confirmed by the user).
- [x] Commit this step (`0b67849`, `a71fafc`).

Suggested commit: `Return richer MCP compile results`

## 4. ESP32 crash decoding

- [x] Extract the existing decoder from the webview handler into a reusable service.
- [x] Add `decode_esp32_backtrace` using the specified sketch/profile and matching ELF build.
- [x] Return decoded functions, files, and line numbers.
- [x] Test missing or mismatched builds, unsupported targets, invalid logs, cancellation, standard/profile toolchains, and the shared webview service (303 AI bridge tests passing).
- [x] Add crash decoding prompts with prerequisites and expected results, and update `AI_ASSISTANTS.md`.
- [ ] Verify crash decoding prompts in an AI client against a matching ESP32 firmware build, including profile selection and unavailable or stale builds.
- [ ] Verify the existing webview decoder still works in VS Code.
- [ ] Commit this step.

Suggested commit: `Expose ESP32 backtrace decoding through MCP`

## 5. Library installation

- [ ] Add `install_library` with explicit package and version inputs.
- [ ] Respect profile dependency declarations and clearly report the installation scope.
- [ ] Return installation progress and a structured result; refresh relevant caches.
- [ ] Test already-installed versions, profile behavior, download failures, and cancellation.
- [ ] Add a library installation prompt with explicit package/version and expected results, then verify it in an AI client.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Add MCP library installation`

## 6. Firmware upload

- [ ] Add `upload_sketch` with explicit sketch, profile where applicable, and port targeting.
- [ ] Require a successful current build matching the requested target.
- [ ] Coordinate with compilation and serial operations; return progress and structured results.
- [ ] Test stale builds, target mismatches, unavailable ports, upload failures, and cancellation.
- [ ] Add an upload prompt with explicit sketch/profile/port, prerequisites, and expected results; use it for the hardware validation below.
- [ ] Validate a hardware upload, update documentation, and commit.

Suggested commit: `Add MCP firmware upload`

## 7. Serial capture

- [ ] Add `capture_serial_output` with explicit port, baud rate, duration, and output limits.
- [ ] Coordinate port ownership with uploads and the existing Serial Monitor.
- [ ] Return captured output with timing and truncation information.
- [ ] Release resources on completion, cancellation, client disconnect, and device removal.
- [ ] Add a serial capture prompt with explicit port/baud/duration, prerequisites, and expected results; use it for the hardware validation below.
- [ ] Test capture limits and lifecycle handling, then validate with a physical board.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Add bounded MCP serial capture`
