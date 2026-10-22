import { main } from './mcpBridge';

void main().catch(() => {
    // stdout is reserved exclusively for MCP protocol frames.
    process.stderr.write('Arduino Maker Workshop bridge could not start. Reconnect from the selected VS Code window.\n');
    process.exitCode = 1;
});
