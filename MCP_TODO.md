# MCP expansion TODO

Track the seven planned additions to the Arduino Maker Workshop AI bridge.
Complete each step with tests, user documentation, and a separate commit.

## Progress

- [ ] 1. Project context and dependencies
- [ ] 2. Board and library discovery
- [ ] 3. Better compile results
- [ ] 4. ESP32 crash decoding
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

## 1. Project context and dependencies

- [ ] Extend `get_project_context` with available profiles and their declared dependencies.
- [ ] Add `list_dependencies` for installed core/library versions and comparison with the selected profile's requirements.
- [ ] Distinguish declared requirements, installed packages, and dependencies resolved by a build.
- [ ] Test missing dependencies, version differences, and projects with and without profiles.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Expose MCP profiles and dependencies`

## 2. Board and library discovery

- [ ] Add `get_board_details` with valid board options and defaults.
- [ ] Add `search_libraries` with bounded search results and available versions.
- [ ] Add `list_examples` for the selected board and installed libraries.
- [ ] Test profile-specific boards, empty results, invalid inputs, and result limits.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Add MCP board and library discovery`

## 3. Better compile results

- [ ] Extend `compile_sketch` results with structured errors and warnings, including source locations when available.
- [ ] Include flash/RAM usage and build artifact paths when available.
- [ ] Preserve existing logs and report when structured details are unavailable.
- [ ] Test successful and failed builds, different output formats, truncation, and stale artifacts.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Return richer MCP compile results`

## 4. ESP32 crash decoding

- [ ] Extract the existing decoder from the webview handler into a reusable service.
- [ ] Add `decode_esp32_backtrace` using the specified sketch/profile and matching ELF build.
- [ ] Return decoded functions, files, and line numbers.
- [ ] Test missing or mismatched builds, unsupported targets, invalid logs, and cancellation.
- [ ] Verify the existing webview decoder still works, update documentation, and commit.

Suggested commit: `Expose ESP32 backtrace decoding through MCP`

## 5. Library installation

- [ ] Add `install_library` with explicit package and version inputs.
- [ ] Respect profile dependency declarations and clearly report the installation scope.
- [ ] Return installation progress and a structured result; refresh relevant caches.
- [ ] Test already-installed versions, profile behavior, download failures, and cancellation.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Add MCP library installation`

## 6. Firmware upload

- [ ] Add `upload_sketch` with explicit sketch, profile where applicable, and port targeting.
- [ ] Require a successful current build matching the requested target.
- [ ] Coordinate with compilation and serial operations; return progress and structured results.
- [ ] Test stale builds, target mismatches, unavailable ports, upload failures, and cancellation.
- [ ] Validate a hardware upload, update documentation, and commit.

Suggested commit: `Add MCP firmware upload`

## 7. Serial capture

- [ ] Add `capture_serial_output` with explicit port, baud rate, duration, and output limits.
- [ ] Coordinate port ownership with uploads and the existing Serial Monitor.
- [ ] Return captured output with timing and truncation information.
- [ ] Release resources on completion, cancellation, client disconnect, and device removal.
- [ ] Test capture limits and lifecycle handling, then validate with a physical board.
- [ ] Update `AI_ASSISTANTS.md` and commit.

Suggested commit: `Add bounded MCP serial capture`
