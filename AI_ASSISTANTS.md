# Use AI assistants with Arduino Maker Workshop (preview)

Connect Codex, Claude Code, or Copilot to inspect your Arduino projects, check
profiles and dependencies, and request compilation. Compile progress appears in
VS Code's Arduino CLI Output panel and status bar, with the usual cancel control.

This preview is disabled by default. Select **AI integration** (the robot icon)
in the extension's navigation bar and turn on **Enable AI integration**.
Home shows a short status summary and a link to the AI integration page. The choice
is saved for this computer and VS Code profile. Trusted local sketch windows
become available to your assistant automatically after reloads and restarts.

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
across sketches in the same profile. Each user runs setup on their own computer.
**Manual setup instructions** opens matching configuration blocks if you prefer
to edit the files yourself.

## Enable, use, and disable

For external clients, install Node.js 20 or newer on the same computer as VS Code.
The `node` command must work in the client's environment. Copilot's automatic
integration uses VS Code's included runtime.

Use a local VS Code window and local sketch files. Remote SSH, WSL, container
workspaces, and clients running on another computer are not supported by this preview.

1. Open a local sketch folder in a local, trusted VS Code window. The first
   workspace folder is the active sketch and must contain a matching
   `sketchName.ino` or `sketchName.pde` file. Use **Add as Active Workspace Folder**
   when necessary.
2. Resolve Arduino CLI setup and select a board or build profile in Arduino Home.
3. On the **AI integration** navigation page, enable the integration and use the setup
   button for your client. Restart the client's MCP server or open a new client
   session as directed. Copilot may ask you to enable the registered server's tools.
4. Once the status shows **Available to assistants**, ask your client to list connected
   sketches, choose the intended sketch, then inspect it. For example: "List my
   connected Arduino sketches, then show the board and profiles for the one I choose."
5. Turn off **Enable AI integration** to revoke access and prevent automatic
   reconnection in all windows sharing this VS Code profile. Closing one sketch
   window ends only that window's session. Reopening a trusted sketch restores its
   availability while the integration is enabled. Saved client entries remain.

The same actions are exposed in the Command Palette as **Arduino Maker Workshop:
Enable AI Integration**, **Disable AI Integration**, **Set Up AI Client**, and
**AI Setup Instructions**. The user setting is `arduinoMakerWorkshop.ai.enabled`.
**Available to assistants** means the integration is ready for requests.

When switching to another trusted local sketch, reuse the same client entry.
Several different sketches can be available at once.
Repeat setup only when moving to another computer or VS Code storage profile.

When several sketches are available, tell your assistant which one to use. If the
same sketch is connected in more than one VS Code window, close its extra windows
before requesting an operation. After a VS Code restart, your client reconnects
on its next request once the extension is ready. If compilation was interrupted,
request it again; interrupted operations are never retried automatically.

## Compilation

AI operations run without extension approval dialogs while AI integration is
enabled in trusted local workspaces. This includes normal and clean compilation.
Your AI client may still apply its own tool permissions.

AI compilation follows the **Verbose Compile** setting
(`arduinoMakerWorkshop.verboseCompile`), just like manual compilation. Changes
apply to the next compile. Long output may be shortened in the assistant's response.

Compilation writes build files and may download dependencies; clean builds may
clear the output directory. Save your sketch files before asking for compilation.
If the sketch or selected target changes during a
build, request another compile before using its output.

To use a particular profile, replace `[profile name]` with one of your profile names
in this example: "Compile my current sketch using the [profile name] profile."
This applies to that request and does not change the profile selected in Home.
You can cancel compilation in VS Code.

## What you can ask your assistant to do

Describe the action and name the sketch you want to use. Your assistant selects
the appropriate tool; you do not need to enter tool arguments yourself.

| Tool | Behavior |
| --- | --- |
| `list_connected_sketches` | Shows sketches available in your running VS Code windows. |
| `get_project_context` | Shows the sketch's board, profiles, declared dependencies, build settings, and configuration issues. |
| `list_dependencies` | Compares installed core and library versions with the selected profile's requirements. |
| `list_boards` | Lists available Arduino boards without changing your board selection. |
| `list_ports` | Lists connected ports without opening a serial monitor or changing your port selection. |
| `compile_sketch` | Compiles the requested sketch and profile and reports the outcome. You can also request a clean build. |

This integration does not currently provide firmware upload, board reset or erase,
bootloader flashing, serial monitoring, or package installation tools.

### Prompt examples

Start by listing connected sketches. If more than one is listed, tell the assistant
which one to use as "my current sketch." Replace `[profile name]` with one of that
sketch's profile names.

Compare the response with the expected result; for compilation, also check the
Arduino CLI Output panel in VS Code.

| Task | Prompt | Expected result |
| --- | --- | --- |
| Find sketches | List my connected sketches. | Names and paths match the sketches available in your running VS Code windows. |
| Inspect a project | Inspect my current sketch, list its profiles, and check the dependencies for its selected profile. | Shows the board, profiles, and declared requirements compared with installed versions, without changing the selected profile. |
| Find boards and ports | Show available boards and connected ports for my current sketch. | Lists boards and detected ports without changing your selections or opening a serial monitor. |
| Compile | Compile my current sketch with its current board or profile and summarize the result. | Uses the current target and reports success or build errors consistent with Arduino CLI Output. |
| Compile a profile | Compile my current sketch using the [profile name] profile. | Builds with the specified profile and reports the outcome; the profile selected in Home stays unchanged. |
| Clean compilation | Perform a clean compilation of my current sketch with its current board or profile. | Runs a clean build with the current target and reports the outcome in the response and Arduino CLI Output. |

### Profiles and dependencies

Ask the assistant: "Show my current sketch's profiles and check its selected
profile's dependencies." This does not change the profile selected in Home.

The assistant can show default and selected profiles, required core and library
versions, and whether matching versions are installed. Without a selected profile,
there are no profile requirements to compare; this check does not scan your source
code for library includes. Local library directory declarations are shown, but
their contents and versions are not inspected.

Profile builds can use their own separate dependency installations. A core or
library reported as missing from the normal installation does not necessarily
mean the profile will fail to compile. This check does not determine which
dependencies a build actually uses.

The assistant reports when dependency information is incomplete or too large to
display. Checking dependencies does not compile, change project settings, or
install the profile's requirements. Arduino CLI may download indexes and built-in
tools while preparing the installed package list.

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
Do not copy another user's paths. If the `node` command is not working, use
the absolute path of a working Node.js 20+ executable.

### Copilot / VS Code

On supported VS Code versions, enabling the integration makes the Arduino Maker
Workshop server available in VS Code's MCP/tool picker. Select it there to use it
with Copilot. Older VS Code versions may not support MCP.

For manual setup, run **MCP: Open User Configuration** from VS Code's Command
Palette. In the profile's `mcp.json`, merge
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

The desktop app, IDE extension, and CLI share MCP configuration when using the same
user account and configuration location on your computer. You do not need to add
the same server separately in each one.

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
up to 15 minutes for a tool request, including compilation. Codex's own tool permissions
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
5. Ask: "List my connected sketches, then inspect the sketch I choose."
   Select the intended path and verify its board or profile before
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
Regenerate setup only when moving to another computer or VS Code storage profile.

## Troubleshooting

- **No sketches are available:** Keep the sketch open in VS Code, trust the
  workspace, complete Arduino CLI setup, and check that AI integration is enabled.
- **The same sketch is connected more than once:** Close its extra VS Code
  windows and retry.
- **Two Arduino Maker Workshop servers appear in your client:** Use the
  `arduino_maker_workshop` entry created by automatic setup. Disable an older
  manually named entry, test the current one, then remove the old entry if it is
  no longer needed.
- **The client still shows old tools after an update:** Restart its MCP server or
  fully quit and reopen the client while the sketch remains open in VS Code.
- **Compilation cannot start:** Save your sketch files, check the selected board
  or profile, and wait for any other compilation or upload to finish. Build output
  must stay inside the sketch folder. Linked source folders and very large source
  trees can prevent AI compilation; follow the reported error.

## Privacy

Your assistant receives the requested project information and command output.
The extension filters common credential fields, but this is best-effort filtering;
avoid putting secrets in build flags or printing them in compiler output. Keep
generated client configuration and the AI bridge storage folder private, and do
not add them to shared project files.
