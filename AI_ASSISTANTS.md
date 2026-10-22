# Local AI assistant bridge (preview)

The extension can expose the selected sketch to MCP clients through a packaged
stdio bridge. The bridge forwards requests to the running extension through
authenticated local IPC. Arduino CLI runs only in the extension host, with the
existing compile output panel, status bar, and cancel control.

This preview is disabled until you run **Arduino Maker Workshop: Connect AI
Assistant (This Session)**. It does not install or configure any AI client.

Each user runs Connect on their own computer. The command generates paths from
that user's VS Code storage; the extension package contains
no developer-specific connection paths. Copy the setup from your own generated
document. Configure one server per computer and VS Code storage profile. That entry
works with any sketch you explicitly connect in that profile. Reloading VS Code or
opening another sketch only requires a new Connect approval, with no edits to the
client arguments.

## Start and stop a session

For external clients, install Node.js 20 or newer on the same computer as VS Code.
The `node` command must work in the client's environment. The native VS Code MCP
provider uses the editor's runtime instead.

1. Open a local sketch folder in a local, trusted VS Code window. The first
   workspace folder is the active sketch and must contain a matching
   `sketchName.ino` file. Use **Add as Active Workspace Folder** when necessary.
2. Resolve Arduino CLI setup and select a board or build profile in Arduino Home.
3. Open VS Code's Command Palette, run **Arduino Maker Workshop: Connect AI
   Assistant (This Session)**, and approve the connection. A document opens with
   your reusable connection settings for this computer and VS Code storage profile.
4. Configure the chosen client once using that document. Ask it to list connected
   sketches, choose the intended sketch, then request its project context. Every
   project operation must include that sketch's explicit `sketchPath`.
5. Run **Arduino Maker Workshop: Disconnect AI Assistant**, close/reload this
   window, or change its workspace folders to revoke the session. Run Connect again
   after a reload; existing client arguments remain valid in the same storage
   profile. No session is restored automatically.

When switching to another sketch, run Connect in that sketch's VS Code window and
reuse the same client entry. Several different sketches can be connected at once.
Repeat setup only when moving to another computer or VS Code storage profile.

The global MCP server searches only the configured `--session-dir` for live,
authorized sessions. `list_connected_sketches` returns their sketch paths and
session counts. The assistant must choose a path from the user's request or ask
which sketch to use when the choice is unclear. Project operations route to the
unique live session for their explicit `sketchPath`. If a sketch has more than one
session, disconnect its extra window sessions; the bridge will not guess between
them. After a debug restart and a new Connect approval, an already running client
reconnects on its next tool call. It never retries an interrupted operation
automatically.

Every assistant compile separately asks for approval in VS Code, showing sketch,
FQBN, profile, output directory, and whether a clean build was requested. Builds
execute board-package recipes, write files, and can download profile dependencies.
Clean builds may clear the output directory. A canceled or disconnected request
cannot execute if a previously shown approval dialog is answered later. VS Code
may leave that dialog visible until you dismiss it.

## Tools

`list_connected_sketches` takes no arguments and returns
`{schemaVersion: 1, sketches: [{sketchPath, sessionCount}]}`. An empty list means
no sketch is currently connected in this storage profile.

The four project tools require an absolute `sketchPath` matching a connected
sketch. They accept an optional existing named `profile`; compilation additionally
accepts `clean: true|false`. Unknown properties and operations are rejected in both
the transport and extension backend.

| Tool | Behavior |
| --- | --- |
| `list_connected_sketches` | Lists live, explicitly connected sketches and their session counts. Does not enable sessions or select a target. |
| `get_project_context` | Reads selected/resolved target, FQBN, build plan, CLI identity, and validation issues. Does not repair or rewrite project configuration. |
| `list_boards` | Runs the extension's `arduino-cli board listall --json`. Does not install or select boards. |
| `list_ports` | Runs `arduino-cli board list --json`. Does not open a monitor, select a port, or upload. |
| `compile_sketch` | After VS Code approval, executes the inspected compile plan and returns structured completion. |

There are no upload, reset, erase, bootloader, serial monitor, package installation,
or arbitrary command tools. Compilation has `readOnlyHint: false`; tool hints are
not the authorization boundary. Trust and consent are checked in the extension.

Compile results include a schema version, operation ID, status, target, exit
code/signal, separate stdout/stderr tails, duration, truncation flag, and a stable
error code when available. Common statuses are `success`, `failed`, `canceled`,
`busy`, and `invalid`. Transport or approval failures are MCP error results.
Progress is available through MCP progress notifications and the existing UI.

The explicit profile applies only to this operation; it does not change Home's
selection. The bridge refreshes metadata and checks source sizes/mtimes before and
after compilation. Changes while approval/build is pending require a fresh request.
It never saves unrelated documents; save dirty sketch documents before compiling.
IntelliSense is refreshed only when the compiled target still matches Home's target.

## Client setup

Use the paths in your own Connect document wherever a placeholder appears below.
Do not copy another user's paths. If `node` is unavailable or a broken shim, use
the absolute path of a working Node.js 20+ executable. This preview has been tested
with simulated clients; actual Copilot, Codex, and Claude Code onboarding remains
a separate validation step.

### Copilot / VS Code

On supported VS Code versions, Connect automatically advertises the Arduino Maker
Workshop server through the extension's native MCP provider. Select it in VS Code's
MCP/tool picker. It uses the editor's Node runtime and the same global tools for
connected sketches in this storage profile. This window advertises it only while
its own session is enabled; it does not edit `mcp.json`. Manual client configuration
uses the reusable arguments below.

The extension keeps its VS Code `^1.93.0` baseline. Provider registration is guarded
by runtime feature detection. Older VS Code versions retain the existing extension
features but may not support MCP. Where manual MCP configuration is supported,
merge the generated entry into your user/profile MCP configuration:

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

[Official VS Code MCP integration](https://code.visualstudio.com/api/extension-guides/ai/mcp).

### Codex desktop, IDE, and CLI

The desktop app, IDE extension, and CLI share MCP configuration on the same Codex
host. You do not need to add the same server separately in each one.

For the desktop app, first run Connect in VS Code and keep its generated document
open. Then:

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

For longer compilations, set `tool_timeout_sec = 900` in this server's
`config.toml` section, as shown below. This is a separate client setting, not a
fourth command argument. The default is 60 seconds, which can expire while waiting
for VS Code approval or compiling. Restart the MCP server after changing its
configuration. See [official OpenAI MCP setup](https://learn.chatgpt.com/docs/extend/mcp).

You can also configure the desktop app, IDE, or CLI by adding the generated entry
to `~/.codex/config.toml` (or an intentionally trusted project configuration).
Use the generated TOML snippet as-is, including its quoting and escaping:

```toml
[mcp_servers.arduino_maker_workshop]
command = "node"
args = ["<stable-launcher.cjs>", "--session-dir", "<private-ai-bridge-directory>"]
tool_timeout_sec = 900
```

Keep client-side tool approval enabled. The extension still requires its own compile
approval. Longer builds or time spent awaiting that approval can exceed a client's
tool timeout; cancellation propagates back to the owning subprocess.

[Official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).

### Claude Code

Use Claude Code's own MCP setup. You can add a local stdio entry using its CLI:

```text
claude mcp add --transport stdio arduino_maker_workshop -- node <stable-launcher.cjs> --session-dir <private-ai-bridge-directory>
```

Quote actual paths containing spaces for your shell, or use the generated JSON
with Claude Code's MCP configuration tools:

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

[Official Claude Code MCP configuration](https://code.claude.com/docs/en/mcp).

For an existing entry using `--sketch` or `--session`, replace all its arguments
with the three values from the new Connect document, then save and restart the
client's MCP server once. After that migration, the same entry works for any
sketch you connect in this storage profile. Regenerate setup only when moving to
another computer or VS Code storage profile, such as a separate development profile.

## Session and privacy boundary

- Each enabled window has a unique session, authenticated with a random 256-bit
  secret. The descriptor is private to the OS user and is never put into a client
  argument or log as a token. Reusable client configuration contains only the
  launcher and bridge storage paths.
- Windows uses a session-specific named pipe; Unix uses a short private temporary
  directory and socket. There is no HTTP listener, remote endpoint, OAuth account,
  persistent allow grant, or selection of an arbitrary window. Each project
  operation requires exactly one live session for its explicit `sketchPath`.
- The launcher is copied from the package into extension global storage only on
  explicit Connect. Its path remains stable across extension upgrades. Session
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

The legacy Arduino Home activation/setup still has its existing CLI setup/update
behavior; observational bridge calls themselves never perform setup or install.

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
the Extension Development Host, run Connect again and reuse the existing client
configuration. If the standalone bridge code itself changed, restart the client's
MCP server after Connect so it loads the rebuilt launcher. Production builds still
clear extension output before building both bundles.

Package the extension with `vsce package` after builds. Confirm that
`build/extension.js`, `build/aiBridge.cjs`, webview assets, and existing native USB
runtime files are present. Do not test this preview by replacing a daily extension
or editing client configuration without an explicit user decision.

Next iterations: actual-client onboarding in an isolated VS Code profile, richer
source diagnostics/tasks, then separately designed serial ownership and device
write consent. No hardware tools should be added by simply widening this allowlist.
