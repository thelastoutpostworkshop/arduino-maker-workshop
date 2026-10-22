# Local AI assistant bridge (preview)

The extension can expose the selected sketch to MCP clients through a packaged
stdio bridge. The bridge forwards requests to the running extension through
authenticated local IPC. Arduino CLI runs only in the extension host, with the
existing compile output panel, status bar, and cancel control.

This preview is disabled by default. Select **AI integration** (the robot icon)
in the extension's navigation bar and turn on **Enable AI integration**.
Home shows a short status summary and a link to this page. The choice is saved for this computer and VS
Code profile. Trusted local sketch windows restore their bridge automatically
after reloads and restarts, including **Run and Debug** restarts.

Choose a setup button once for each client you want to use:

| Client | Primary setup | Destination |
| --- | --- | --- |
| Codex desktop, IDE, or CLI | **Set up Codex** saves the server entry and compile timeout | `~/.codex/config.toml`, or `$CODEX_HOME/config.toml` when set |
| Claude Code | **Set up Claude Code** saves a user-level server entry | `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when set |
| Copilot / VS Code | **Use with Copilot** explains selecting the automatically registered server | VS Code MCP tools picker; no configuration file is edited |

The buttons generate paths and arguments for you. They do not require the Codex
or Claude CLI to be installed and do not install an AI client. Codex uses TOML;
Claude Code uses JSON. Only the chosen client's Arduino Maker Workshop entry is
configured. Other servers, client settings, and tool approval preferences are
preserved. Existing files are backed up alongside the original with an
`.amw-backup-...` suffix before changes, and invalid configuration is left intact
with an error. Setup can be run again to update an old entry.

Configure one server per computer and VS Code storage profile. That entry works
across sketches in the same profile. Each user runs setup on their own computer;
the extension contains no developer-specific paths. **Manual setup instructions**
opens matching configuration blocks if you prefer to edit the files yourself.

## Enable, use, and disable

For external clients, install Node.js 20 or newer on the same computer as VS Code.
The `node` command must work in the client's environment. The native VS Code MCP
provider uses the editor's runtime instead.

1. Open a local sketch folder in a local, trusted VS Code window. The first
   workspace folder is the active sketch and must contain a matching
   `sketchName.ino` or `sketchName.pde` file. Use **Add as Active Workspace Folder**
   when necessary.
2. Resolve Arduino CLI setup and select a board or build profile in Arduino Home.
3. On the **AI integration** navigation page, enable the integration and use the setup
   button for your client. Restart the client's MCP server or open a new client
   session as directed. Copilot may ask you to enable the registered server's tools.
4. Once the status shows **Available to assistants**, ask your client to list connected
   sketches, choose the intended sketch, then request its project context. Every
   project operation must include that sketch's explicit `sketchPath`.
5. Turn off **Enable AI integration** to revoke access and prevent automatic
   reconnection in all windows sharing this VS Code profile. Closing one sketch
   window ends only that window's session. Reopening a trusted sketch restores its
   availability while the integration is enabled. Saved client entries remain.

The same actions are exposed in the Command Palette as **Arduino Maker Workshop:
Enable AI Integration**, **Disable AI Integration**, **Set Up AI Client**, and
**AI Setup Instructions**. The user setting is `arduinoMakerWorkshop.ai.enabled`;
a workspace cannot opt itself in. Availability means the bridge is ready, not that
an assistant has already connected.

When switching to another trusted local sketch, reuse the same client entry.
Several different sketches can be available at once.
Repeat setup only when moving to another computer or VS Code storage profile.

The global MCP server searches only the configured `--session-dir` for live,
authorized sessions. `list_connected_sketches` returns their sketch paths and
session counts. The assistant must choose a path from the user's request or ask
which sketch to use when the choice is unclear. Project operations route to the
unique live session for their explicit `sketchPath`. If a sketch has more than one
session, close its extra sketch windows; the bridge will not guess between
them. After a debug restart, an already running client reconnects on its next tool
call once the extension is ready. It never retries an interrupted operation
automatically.

## Compilation

AI operations run without extension approval dialogs while AI integration is
enabled in trusted local workspaces. This includes normal and clean compilation.
Your AI client may still apply its own tool permissions.

AI compilation follows the **Verbose Compile** setting
(`arduinoMakerWorkshop.verboseCompile`), just like manual compilation. Changes
apply to the next compile. The AI bridge's output size limits still apply.

Builds execute board-package recipes, write build files, and may download
dependencies; clean builds may clear the output directory. Trust, sketch scope,
unsaved-file checks, and cancellation checks still apply.

## Tools

`list_connected_sketches` takes no arguments and returns
`{schemaVersion: 1, sketches: [{sketchPath, sessionCount}]}`. An empty list means
no sketch is currently connected in this storage profile.

The five project tools require an absolute `sketchPath` matching a connected
sketch. They accept an optional existing named `profile`; compilation additionally
accepts `clean: true|false`. Unknown properties and operations are rejected in both
the transport and extension backend.

| Tool | Behavior |
| --- | --- |
| `list_connected_sketches` | Lists live sketches available through the enabled integration and their session counts. Does not enable the integration or select a target. |
| `get_project_context` | Reads available profiles and declared dependencies, selected/resolved target, FQBN, build plan, CLI identity, and validation issues. Does not repair or rewrite project configuration. |
| `list_dependencies` | Queries standard CLI core/library installations and compares their versions with the selected profile's declarations. Does not inspect isolated profile caches or determine build-resolved dependencies. CLI initialization can download indexes and built-in tools. |
| `list_boards` | Runs the extension's `arduino-cli board listall --json`. Does not install or select boards. |
| `list_ports` | Runs `arduino-cli board list --json`. Does not open a monitor, select a port, or upload. |
| `compile_sketch` | Executes the inspected compile plan automatically and returns structured completion. |

There are no upload, reset, erase, bootloader, serial monitor, package installation,
or arbitrary command tools. Compilation and dependency inventory have
`readOnlyHint: false`; the latter is conservative because CLI initialization can
change its supporting files. Tool hints are not the authorization boundary. Trust
and AI enablement are checked in the extension.

### Profiles and dependencies

Ask the assistant: "Show the available profiles and check the dependencies for
the release profile." It should use `get_project_context`, then call
`list_dependencies` with the chosen `sketchPath` and optional `profile`.
This does not change the profile selected in Home.

Project context includes `defaultProfile` when declared, `availableProfiles` with
default/selected flags and each profile's dependency declarations, and
`declaredDependencies` for the resolved profile. Declarations include platform IDs,
optional versions and index URLs, library names/versions, transitive dependencies,
and local library directories. Local directory contents are not read. Metadata
issues in an unrelated profile do not prevent compiling a valid selected profile.
Profile/declaration output is bounded; `availableProfilesTruncated` or declaration
issues indicate omitted metadata.

`list_dependencies` returns separate sections:

- `declared` and `declaredComplete`: requirements from the selected profile and
  whether those declarations were read completely. Without a profile, this is an
  empty declaration list, not a scan of source includes.
- `installed`: installed platform/library versions from fixed
  `arduino-cli core list --json` and `arduino-cli lib list --all --json` queries.
  It excludes unrelated CLI metadata, such as author information and example paths.
- `comparison`: `installed`, `not_found`, `version_mismatch`, or `unknown` for each
  requirement, with matching installed versions. These statuses describe standard
  CLI installations only. Local directory requirements remain `unknown`.
- `buildResolved`: `status: "not_reported"`. Profile builds use isolated dependency
  caches; a missing or different standard installation does not establish whether
  that profile will compile successfully.

CLI initialization warnings mark the inventory incomplete and prevent definitive
absence/version-mismatch conclusions for the affected inventory. Malformed or
oversized CLI output returns an error rather than an empty inventory. Neither
query activates a profile, compiles, changes project settings, or explicitly
installs its declared core/library requirements. Arduino CLI may initialize its
own indexes and built-in tools, including downloads. No extension approval dialog
is added; client tool permissions still apply.

### Compile results

Compile results include a schema version, operation ID, status, target, exit
code/signal, separate stdout/stderr tails, duration, truncation flag, and a stable
error code when available. Common statuses are `success`, `failed`, `canceled`,
`busy`, and `invalid`. Transport or operation validation failures are MCP error results.
Progress is available through MCP progress notifications and the existing UI.

The explicit profile applies only to this operation; it does not change Home's
selection. The bridge refreshes metadata and checks source sizes/mtimes before and
after compilation. Changes while a build is pending require a fresh request.
It never saves unrelated documents; save dirty sketch documents before compiling.
IntelliSense is refreshed only when the compiled target still matches Home's target.

## Client setup

Use the AI integration page's setup buttons for automatic configuration. Manual
alternatives are also available through **Manual setup instructions**. Copy the matching TOML
or JSON example from your generated document, without the Markdown
code fences. If the destination file already contains settings, preserve them
and merge only the `arduino_maker_workshop` server entry. Replace an existing entry
with that same name; do not add duplicate TOML tables, JSON keys, or root objects.
Keep the generated quoting and escaping when editing a configuration file,
including doubled Windows backslashes. The optional form fields described below
use raw values instead.

Use the paths in your own setup document wherever a placeholder appears below.
Do not copy another user's paths. If `node` is unavailable or a broken shim, use
the absolute path of a working Node.js 20+ executable. This preview has been tested
with simulated clients; actual Copilot, Codex, and Claude Code onboarding remains
a separate validation step.

### Copilot / VS Code

On supported VS Code versions, enabling the integration advertises the Arduino Maker
Workshop server through the extension's native MCP provider. Select it in VS Code's
MCP/tool picker. It uses the editor's Node runtime and the same global tools for
connected sketches in this storage profile. This window advertises it only while
its own session is enabled; it does not edit `mcp.json`. Manual client configuration
uses the reusable arguments below.

The extension keeps its VS Code `^1.93.0` baseline. Provider registration is guarded
by runtime feature detection. Older VS Code versions retain the existing extension
features but may not support MCP. For manual setup, run **MCP: Open User
Configuration** from VS Code's Command Palette. In the profile's `mcp.json`, merge
the generated server entry into the existing `servers` object, replacing an entry
with the same name if present. If the file is empty, paste the full JSON block:

```json
{
  "servers": {
    "arduino_maker_workshop": {
      "type": "stdio",
      "command": "node",
      "args": ["<stable-launcher.cjs>", "--session-dir", "<private-ai-bridge-directory>"]
    }
  }
}
```

Save the file, then use **MCP: List Servers** to start or restart Arduino Maker
Workshop. Ask the assistant to call `list_connected_sketches` first, then inspect
the sketch you choose. See [official VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### Codex desktop, IDE, and CLI

The desktop app, IDE extension, and CLI share MCP configuration on the same Codex
host. You do not need to add the same server separately in each one.

**Set up Codex** handles this file for you, including `tool_timeout_sec = 900`.
For manual setup, open `~/.codex/config.toml` (`%USERPROFILE%\.codex\config.toml` on Windows) and
paste the generated TOML block. If `[mcp_servers.arduino_maker_workshop]` already
exists, replace that table instead of adding another one. Preserve unrelated
settings and server tables. The example below contains placeholders; the setup
document supplies your actual paths:

```toml
[mcp_servers.arduino_maker_workshop]
command = "node"
args = ["<stable-launcher.cjs>", "--session-dir", "<private-ai-bridge-directory>"]
tool_timeout_sec = 900
```

Save the file, then restart the MCP server or your Codex client. Ask it to call
`list_connected_sketches` first, then inspect the sketch you choose. Verify the
path and board or profile before requesting a compile.

`tool_timeout_sec = 900` is a client setting, not a command argument. It allows
time for compilation; the default is 60 seconds. Codex's own tool permissions
still apply. See [official OpenAI MCP setup](https://learn.chatgpt.com/docs/extend/mcp).

#### Optional alternative: Codex desktop form

Use this form instead of editing TOML if you prefer entering individual fields.
First enable AI integration in VS Code and open **Manual setup instructions**. Then:

1. Open **Settings > MCP servers** and choose **Add server**, or edit an existing
   Arduino Maker Workshop entry.
2. Give it a name such as `arduino_maker_workshop`, choose **STDIO**, and set
   **Command** to `node`.
3. Add these three **Arguments** as separate entries, in this order, using the
   values from your generated document:

   | Entry | Value |
   | --- | --- |
   | 1 | The full path to `launcher.cjs` |
   | 2 | `--session-dir` |
   | 3 | The full path to your `ai-bridge` storage directory |

   Paste the raw value into each argument field. Do not add surrounding quotes,
   brackets, commas, or JSON escaping. A path containing spaces is still one
   argument. Keep ordinary Windows backslashes as shown in the raw-value section
   of the generated document.
4. Select **Save**, then **Restart**.
5. Ask: "List connected Arduino Maker Workshop sketches, then inspect the sketch
   I choose." Select the intended path and verify its board or profile before
   requesting a compile.

For compilation, also set `tool_timeout_sec = 900` in this server's `config.toml`
table and restart it. Do not enter that setting as a fourth argument.

### Claude Code

**Set up Claude Code** handles its user configuration for you. Start a new Claude
conversation or restart the client after setup. Project-specific overrides and
disabled-server choices are preserved and can take precedence over this user entry.
Use `/mcp` to check them if the server is missing or disabled.

For manual setup, close Claude Code, then open its user configuration, `~/.claude.json`
(`%USERPROFILE%\.claude.json` on Windows). This file applies across projects.
Merge the generated `arduino_maker_workshop` entry into its top-level `mcpServers`
object, replacing an existing entry with the same name. Preserve all other
settings and server entries. If the file is empty, paste the full generated JSON
block. This is Claude Code's configuration, not Claude Desktop's settings file:

```json
{
  "mcpServers": {
    "arduino_maker_workshop": {
      "type": "stdio",
      "command": "node",
      "args": ["<stable-launcher.cjs>", "--session-dir", "<private-ai-bridge-directory>"]
    }
  }
}
```

Save the file and restart Claude Code. Use `/mcp` to check the server, then ask it
to call `list_connected_sketches` and inspect the sketch you choose. Claude Code
also supports the alternative `claude mcp add-json --scope user` command; it takes
one server's JSON object without the `mcpServers` wrapper and requires shell
quoting. See [official Claude Code user configuration](https://code.claude.com/docs/en/mcp#user-scope)
and [JSON configuration](https://code.claude.com/docs/en/mcp#add-mcp-servers-from-json-configuration).

### Updating an existing AI connection

For an existing entry using `--sketch` or `--session`, run the matching setup button
again, or update the entry with the matching TOML or JSON block from the setup
document. Restart the client's MCP server once. The new arguments contain only
the launcher path, `--session-dir`, and the bridge storage folder. After that
migration, the same entry works for any sketch available in this storage profile.
Regenerate setup only when moving to
another computer or VS Code storage profile, such as a separate development profile.

## Session and privacy boundary

- Each enabled window has a unique session, authenticated with a random 256-bit
  secret. The descriptor is private to the OS user and is never put into a client
  argument or log as a token. Reusable client configuration contains only the
  launcher and bridge storage paths.
- Windows uses a session-specific named pipe; Unix uses a short private temporary
  directory and socket. There is no HTTP listener, remote endpoint, OAuth account,
  or selection of an arbitrary window. Enablement is persistent user consent;
  AI operations run without additional extension approval. Each project operation
  requires exactly one live session for its explicit `sketchPath`.
- The launcher is copied from the package into extension global storage only on
  enabled startup. Its path remains stable across extension upgrades. Session
  descriptors and tokens intentionally change; closed-host descriptors grant no
  access even if an abrupt crash leaves an inert file behind.
- The boundary trusts the OS user and installed extension/package recipes. It does
  not protect against malicious processes already running as that user. Keep the
  descriptor private and do not commit generated client settings.
- Raw project configuration and notes are not exported. Known credential-valued
  build flags and common password/token/key fields are redacted, including output
  split across process chunks. This is best-effort filtering, not a secret detector;
  avoid printing credentials or putting them in build flags.
- Retained compiler output is capped at 64 KiB per stream; the assistant UI
  transcript is capped at 128 KiB. Oversized lines are omitted safely. Discovery
  JSON is capped at 512 KiB. Protocol frames and concurrent calls are also bounded.

Inspection requires explicit canonical scope. Output paths cannot escape the sketch
through `..`, absolute paths, or directory links, and reserved source/metadata paths
are rejected. Linked source trees or a scan exceeding 20,000 entries currently
block assistant compilation. Remote SSH/WSL/container windows and cross-host clients
are outside this first slice.

The legacy Arduino Home activation/setup keeps its existing CLI setup/update
behavior. `get_project_context` reads local project metadata without invoking the
CLI. CLI inventory queries can trigger Arduino CLI's own initialization behavior;
the bridge does not call setup or package installation commands for these queries.

## Development validation

```text
npm run typecheck
npm run test:ai
npm run lint
npm run vscode:prepublish
```

`test:ai` builds the standalone bridge, compiles test fixtures, and runs simulated
IPC/MCP, authorization, project inspection, process, and lifecycle tests. It uses
temporary files and controlled Node child processes; it never invokes Arduino CLI
or hardware. Filesystem-link tests require permission to create test junctions.

For development, `npm run watch` watches both the extension and the standalone
AI bridge. Each watcher preserves the other bundle in `build/`. After restarting
the Extension Development Host, enabled integration restores itself; reuse the
existing client configuration. If the standalone bridge code itself changed,
restart the client's MCP server once the bridge is available so it loads the
rebuilt launcher. Production builds still clear extension output before building
both bundles.

Package the extension with `vsce package` after builds. Confirm that
`build/extension.js`, `build/aiBridge.cjs`, webview assets, and existing native USB
runtime files are present. Do not test this preview by replacing a daily extension
or editing client configuration without an explicit user decision.

Next iterations: actual-client onboarding in an isolated VS Code profile, richer
source diagnostics/tasks, then separately designed serial ownership and device
write consent. No hardware tools should be added by simply widening this allowlist.
