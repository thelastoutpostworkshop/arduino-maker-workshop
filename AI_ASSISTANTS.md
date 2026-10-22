# Local AI assistant bridge (preview)

The extension can expose the selected sketch to MCP clients through a packaged
stdio bridge. The bridge forwards requests to the running extension through
authenticated local IPC. Arduino CLI runs only in the extension host, with the
existing compile output panel, status bar, and cancel control.

This preview is disabled until you run **Arduino Maker Workshop: Connect AI
Assistant (This Session)**. It does not install or configure any AI client.

## Start and stop a session

1. Open a local sketch folder in a local, trusted VS Code window. The first
   workspace folder is the active sketch and must contain a matching
   `sketchName.ino` file. Use **Add as Active Workspace Folder** when necessary.
2. Resolve Arduino CLI setup and select a board or build profile in Arduino Home.
3. Run **Arduino Maker Workshop: Connect AI Assistant (This Session)** and approve
   the connection. A document opens with reusable connection snippets for this
   sketch and VS Code storage location.
4. Configure the chosen client once using that document. Start by requesting
   project context. MCP initialization also identifies the exact configured sketch
   path; clients must pass it explicitly on every tool call.
5. Run **Arduino Maker Workshop: Disconnect AI Assistant**, close/reload this
   window, or change its workspace folders to revoke the session. Run Connect again
   after a reload; existing client arguments remain valid for the same sketch and
   storage location. No session is restored automatically.

External clients select a sketch explicitly with `--sketch` and search only the
configured `--session-dir` for its live, authorized session. After a debug restart
and a new Connect approval, an already running client reconnects on its next tool
call. It never retries an interrupted operation automatically. If multiple windows
have connected that same sketch, disconnect the extra sessions; the bridge will
not choose between them.

Every assistant compile separately asks for approval in VS Code, showing sketch,
FQBN, profile, output directory, and whether a clean build was requested. Builds
execute board-package recipes, write files, and can download profile dependencies.
Clean builds may clear the output directory. A canceled or disconnected request
cannot execute if a previously shown approval dialog is answered later. VS Code
may leave that dialog visible until you dismiss it.

## Tools

All tools require an absolute `sketchPath` matching the connected active sketch.
They accept an optional existing named `profile`; compilation additionally accepts
`clean: true|false`. Unknown properties and operations are rejected in both the
transport and extension backend.

| Tool | Behavior |
| --- | --- |
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

The Connect command generates actual paths. Replace the placeholders below with
those paths. External clients need Node.js 20 or newer on the same host as
the extension. If `node` is an unavailable or broken shim, use the absolute path of
a working Node executable. This preview has been tested with simulated clients;
actual Copilot, Codex, and Claude Code onboarding remains a separate validation step.

### Copilot / VS Code

On hosts exposing `lm.registerMcpServerDefinitionProvider`, an enabled session is
advertised by the extension's MCP provider. Select the server in VS Code's MCP/tool
picker. The provider uses the editor's Node runtime and stays tied to that exact
window session; it does not edit `mcp.json`. Manual client configuration uses the
reusable sketch-scoped arguments below.

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
      "args": ["<stable-launcher.cjs>", "--sketch", "<absolute-sketch-path>", "--session-dir", "<private-ai-bridge-directory>"]
    }
  }
}
```

[Official VS Code MCP integration](https://code.visualstudio.com/api/extension-guides/ai/mcp).

### Codex IDE / CLI

The IDE and CLI share their host's MCP configuration. Manually add the generated
entry to `~/.codex/config.toml` (or an intentionally trusted project configuration):

```toml
[mcp_servers.arduino_maker_workshop]
command = "node"
args = ["<stable-launcher.cjs>", "--sketch", "<absolute-sketch-path>", "--session-dir", "<private-ai-bridge-directory>"]
tool_timeout_sec = 900
```

Keep client-side tool approval enabled. The extension still requires its own compile
approval. Longer builds or time spent awaiting that approval can exceed a client's
tool timeout; cancellation propagates back to the owning subprocess.

[Official Codex MCP configuration](https://developers.openai.com/codex/mcp).

### Claude Code

Use Claude Code's own MCP setup. You can add a local stdio entry using its CLI:

```text
claude mcp add --transport stdio arduino_maker_workshop -- node <stable-launcher.cjs> --sketch <absolute-sketch-path> --session-dir <private-ai-bridge-directory>
```

Quote actual paths containing spaces for your shell, or use the generated JSON
with Claude Code's MCP configuration tools:

```json
{
  "mcpServers": {
    "arduino_maker_workshop": {
      "type": "stdio",
      "command": "node",
      "args": ["<stable-launcher.cjs>", "--sketch", "<absolute-sketch-path>", "--session-dir", "<private-ai-bridge-directory>"]
    }
  }
}
```

[Official Claude Code MCP configuration](https://code.claude.com/docs/en/mcp).

Existing `--session <private-session.json>` configurations remain supported and
stay bound to that one session. To avoid updating arguments after every reload,
replace a legacy entry with the generated sketch-scoped entry and restart that
client's MCP server once. Regenerate setup if you change the sketch location or
use a different VS Code storage location, such as a separate development profile.

## Session and privacy boundary

- Each enabled window has a unique session, authenticated with a random 256-bit
  secret. The descriptor is private to the OS user and is never put into a client
  argument or log as a token. Reusable client configuration contains only the
  launcher, selected sketch, and bridge storage paths.
- Windows uses a session-specific named pipe; Unix uses a short private temporary
  directory and socket. There is no HTTP listener, remote endpoint, OAuth account,
  persistent allow grant, or selection of an arbitrary window. Reconnection
  requires exactly one live session for the explicitly configured sketch.
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
