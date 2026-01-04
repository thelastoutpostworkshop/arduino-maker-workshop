import { commands, Disposable, Webview, WebviewPanel, window, Uri, ViewColumn, ExtensionContext, Position, Range, Selection, workspace } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, BacktraceDecodeFrame, BacktraceDecodeResult, ESP32_PARTITION_BUILDER_BASE_URL, PROFILES_STATUS, SketchProjectFile, WebviewToExtensionMessage } from './shared/messages';
import { arduinoCLI, arduinoExtensionChannel, arduinoProject, arduinoYaml, changeTheme, compile, loadArduinoConfiguration, openExample, shouldDetectPorts, updateStateCompileUpload } from "./extension";

const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

export class VueWebviewPanel {

    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];
    public static currentPanel: VueWebviewPanel | undefined;
    private usbChange() {
        if (shouldDetectPorts()) {
            VueWebviewPanel.sendMessage({ command: ARDUINO_MESSAGES.REQUEST_BOARD_CONNECTED, errorMessage: "", payload: "" });
        }
    }
    private constructor(panel: WebviewPanel, extensionUri: Uri) {
        this._panel = panel;
        if (os.platform() === 'win32') {
            const usb = require('usb').usb;
            usb.on("attach", () => {
                this.usbChange();
            });
            usb.on("detach", () => {
                this.usbChange();
            });
        }
        // Handle messages from the Vue web application
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtensionMessage) => {
                switch (message.command) {
                    case ARDUINO_MESSAGES.CLI_CREATE_NEW_SKETCH:
                        arduinoCLI.createNewSketch(message.payload);
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                        const projectStatus = arduinoProject.getStatus();
                        if (projectStatus.status == ARDUINO_ERRORS.WRONG_FOLDER_NAME) {
                            arduinoExtensionChannel.appendLine(`Project status has errors`);
                        } else {
                            arduinoExtensionChannel.appendLine(`Project status is good`);
                        }
                        message.payload = projectStatus;
                        VueWebviewPanel.sendMessage(message);
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                        const projectInfo = this.createWebviewMessage(ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO);
                        if (loadArduinoConfiguration()) {
                            arduinoExtensionChannel.appendLine(`Loading project configuration`);
                            projectInfo.payload = arduinoProject.getArduinoConfiguration();
                        } else {
                            arduinoExtensionChannel.appendLine(`Not an Arduino Project`);
                            projectInfo.errorMessage = "Not an Arduino Project";
                        }
                        VueWebviewPanel.sendMessage(projectInfo);
                        break;

                    case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                        arduinoCLI.getBoardConfiguration().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        }).catch(() => {
                            // Board info is wrong or not installed
                            arduinoProject.setBoard("");
                            arduinoProject.setConfiguration("");
                            arduinoProject.setPort("");
                            message.payload = "";
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS_PROFILE:
                        arduinoCLI.getProfileBoardConfiguration(message.payload).then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        }).catch(() => {
                            message.payload = "";
                            message.errorMessage = "Board not installed"
                            VueWebviewPanel.sendMessage(message);
                        })
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                        arduinoCLI.getBoardsListAll().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
                        arduinoCLI.getBoardConnected().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_BOARD_OPTIONS:
                        this.setConfiguration(message);
                        updateStateCompileUpload();
                        break;
                    case ARDUINO_MESSAGES.SET_BOARD:
                        this.setBoard(message);
                        arduinoProject.resetBoardConfiguration();
                        arduinoExtensionChannel.appendLine(`Current Board Configuration: ${arduinoProject.getBoardConfiguration()}`);
                        updateStateCompileUpload();
                        arduinoCLI.getBoardConfiguration().then((result) => {
                            message.command = ARDUINO_MESSAGES.CLI_BOARD_OPTIONS;
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_PORT:
                        this.setPort(message);
                        break;
                    case ARDUINO_MESSAGES.SET_MONITOR_PORT_SETTINGS:
                        this.setMonitorPortSettings(message);
                        break;
                    case ARDUINO_MESSAGES.SET_PROGRAMMER:
                        arduinoProject.setProgrammer(message.payload);
                        break;
                    case ARDUINO_MESSAGES.SET_USE_PROGRAMMER:
                        arduinoProject.setUseProgrammer(message.payload);
                        break;
                    case ARDUINO_MESSAGES.CREATE_BUILD_PROFILE:
                        this.createBuildProfile(message);
                        break;
                    case ARDUINO_MESSAGES.DELETE_BUILD_PROFILE:
                        arduinoYaml.deleteProfile(message.payload);
                        updateStateCompileUpload();
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_LIBRARIES:
                        arduinoYaml.updateProfileLibraries(message.payload);
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_DUPLICATE:
                        arduinoYaml.duplicateProfile(message.payload);
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_PLATFORMS:
                        arduinoYaml.updateProfilePlatforms(message.payload);
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_FQBN:
                        arduinoYaml.updateProfileFqbn(message.payload);
                        break;
                    case ARDUINO_MESSAGES.RENAME_BUILD_PROFILE_NAME:
                        arduinoYaml.renameProfile(message.payload);
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_NOTES:
                        arduinoYaml.updateProfileNotes(message.payload);
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_PROGRAMMER:
                        arduinoYaml.updateProfileProgrammer(message.payload);
                        break;
                    case ARDUINO_MESSAGES.UPDATE_BUILD_PROFILE_PORT_SETTINGS:
                        arduinoYaml.updateProfilePortSettings(message.payload);
                        break;
                    case ARDUINO_MESSAGES.SET_COMPILE_PROFILE:
                        arduinoProject.setCompileProfile(message.payload);
                        break;
                    case ARDUINO_MESSAGES.GET_BUILD_PROFILES:
                        sendBuildProfiles();
                        break;
                    case ARDUINO_MESSAGES.SET_STATUS_BUILD_PROFILE:
                        arduinoYaml.setProfileStatus(message.payload);
                        break;
                    case ARDUINO_MESSAGES.SET_DEFAULT_PROFILE:
                        arduinoYaml.setDefaultProfile(message.payload);
                        break;
                    case ARDUINO_MESSAGES.SET_OPTIMIZE_FOR_DEBUG:
                        arduinoProject.setOptimizeForDebug(message.payload);
                        arduinoCLI.setBuildResult(false);
                        break;
                    case ARDUINO_MESSAGES.CLI_UPDATE_INDEX:
                        arduinoCLI.getCoreUpdate().then(() => {
                            arduinoCLI.getOutdatedBoardAndLib().then((result) => {
                                message.payload = result;
                                VueWebviewPanel.sendMessage(message);
                            });
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_INSTALL_CORE_VERSION:
                        const coreToUpdate = message.payload;
                        arduinoCLI.runInstallCoreVersion(coreToUpdate).then(() => {
                            message.command = ARDUINO_MESSAGES.CORE_VERSION_INSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_INSTALL_LIBRARY:
                        const libToInstall = message.payload;
                        arduinoCLI.runInstallLibraryVersion(libToInstall).then(() => {
                            message.command = ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        }).catch(() => {
                            // Library installation error
                            message.payload = "";
                            message.command = ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLATION_ERROR;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_UNINSTALL_LIBRARY:
                        arduinoCLI.runUninstallLibrary(message.payload).then(() => {
                            message.command = ARDUINO_MESSAGES.LIBRARY_UNINSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_UNINSTALL_CORE:
                        const coreToUninstall = message.payload;
                        arduinoCLI.runUninstallCoreVersion(coreToUninstall).then(() => {
                            message.command = ARDUINO_MESSAGES.CORE_UNINSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                        arduinoCLI.searchCore().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                        arduinoCLI.searchLibrary().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                        arduinoCLI.searchLibraryInstalled().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    // case ARDUINO_MESSAGES.CLI_OUTDATED:
                    //     arduinoCLI.getOutdatedBoardAndLib().then((result) => {
                    //         message.payload = result;
                    //         VueWebviewPanel.sendMessage(message);
                    //     });
                    //     break;
                    case ARDUINO_MESSAGES.OPEN_LIBRARY:
                        openExample(message.payload);
                        break;
                    case ARDUINO_MESSAGES.CLI_GET_CONFIG:
                        arduinoCLI.getArduinoConfig().then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_REMOVE_ADDITIONAL_URL:
                        arduinoCLI.removeCLIConfigAdditionalBoardURL(message.payload).then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_ADD_ADDITIONAL_URL:
                        arduinoCLI.addCLIConfigAdditionalBoardURL(message.payload).then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_SET_ADDITIONAL_URL:
                        arduinoCLI.setCLIConfigAdditionalBoardURL(message.payload).then((result) => {
                            message.payload = result;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.GET_PARTITION_BUILDER_URL:
                        const partitionBuilderResult = this.getPartitionBuilderUrl();
                        message.payload = partitionBuilderResult.url;
                        message.errorMessage = partitionBuilderResult.error ?? "";
                        VueWebviewPanel.sendMessage(message);
                        break;
                    case ARDUINO_MESSAGES.DECODE_ESP32_BACKTRACE:
                        this.decodeEsp32Backtrace(message.payload).then((result) => {
                            message.payload = result;
                            message.errorMessage = result.error ?? "";
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.OPEN_FILE_AT_LOCATION:
                        this.openFileAtLocation(message.payload);
                        break;
                    case ARDUINO_MESSAGES.OPEN_WORKSPACE_FOLDER:
                        commands.executeCommand('vscode.openFolder', undefined, { forceNewWindow: false });
                        break;
                    case ARDUINO_MESSAGES.SELECT_SKETCH_FOLDER:
                        arduinoProject.selectSketchFolder().then((selected) => {
                            if (selected) {
                                const projectInfo = this.createWebviewMessage(ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO);
                                projectInfo.payload = arduinoProject.getArduinoConfiguration();
                                VueWebviewPanel.sendMessage(projectInfo);
                                updateStateCompileUpload();
                            }
                        });
                        break;
                    case ARDUINO_MESSAGES.INSTALL_ZIP_LIBRARY:
                        arduinoCLI.installZipLibrary(message.payload).then(() => {
                            message.command = ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED;
                            VueWebviewPanel.sendMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.SET_CONFIGURATION_REQUIRED:
                        arduinoProject.setConfigurationRequired(message.payload);
                        break;
                    case ARDUINO_MESSAGES.LOG_DEBUG:
                        arduinoExtensionChannel.appendLine(`WebView DEBUG message: ${message.payload}`)
                        break;
                    default:
                        arduinoExtensionChannel.appendLine(`Unknown command received from webview: ${message.command}`);
                }
            },
            null,
            this._disposables
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
        arduinoExtensionChannel.appendLine("Arduino Web view ready");
    }

    private createBuildProfile(message: WebviewToExtensionMessage) {
        let restoreActiveBuildProfile: boolean = false
        if (arduinoYaml.status() == PROFILES_STATUS.ACTIVE) {
            // When creating build profiles, the yaml file must be inactive
            restoreActiveBuildProfile = true;
            arduinoYaml.setProfileStatus(PROFILES_STATUS.INACTIVE)
        }
        compile(false, true).then((profile) => {
            if (profile) {
                arduinoYaml.createProfile(message.payload, profile);
                message.command = ARDUINO_MESSAGES.BUILD_PROFILE_CREATED;
                VueWebviewPanel.sendMessage(message);
                window.showInformationMessage(`Profile ${message.payload} created`);
            } else {
                message.command = ARDUINO_MESSAGES.BUILD_PROFILE_CREATED;
                VueWebviewPanel.sendMessage(message);
                window.showErrorMessage(`Profile ${message.payload} not created`);
            }
        }).finally(() => {
            if (restoreActiveBuildProfile) {
                arduinoYaml.setProfileStatus(PROFILES_STATUS.ACTIVE)
            }
        });
    }

    private setBoard(message: WebviewToExtensionMessage) {
        const fqbn = message.payload;
        // arduinoExtensionChannel.appendLine(`Set Board FQBN=:${fqbn}`);
        arduinoProject.setBoard(fqbn);
    }

    private setConfiguration(message: WebviewToExtensionMessage) {
        const configuration = message.payload;
        // arduinoExtensionChannel.appendLine(`New Configration=:${configuration}`);
        arduinoProject.setConfiguration(configuration);
        arduinoProject.setConfigurationRequired(true);
    }

    private setPort(message: WebviewToExtensionMessage) {
        const port = message.payload;
        // arduinoExtensionChannel.appendLine(`New Port=:${port}`);
        arduinoProject.setPort(port);
    }

    private setMonitorPortSettings(message: WebviewToExtensionMessage) {
        const monitorPortSettings = JSON.parse(message.payload);
        // arduinoExtensionChannel.appendLine(`New monitorPortSettings=:${JSON.stringify(monitorPortSettings)}`);
        arduinoProject.setMonitorPortSettings(monitorPortSettings);
    }

    private createWebviewMessage(command: string): WebviewToExtensionMessage {
        return {
            command: command,
            errorMessage: "",
            payload: ""
        };
    }

    private getPartitionBuilderUrl(): { url: string; error?: string } {
        const baseUrl = ESP32_PARTITION_BUILDER_BASE_URL;
        const partitionsPath = this.findPartitionsCsv();
        if (!partitionsPath) {
            return { url: baseUrl, error: "partitions.csv not found in the build output." };
        }
        arduinoExtensionChannel.appendLine(`ESP32 Partition Builder: using partitions.csv at ${partitionsPath}`);

        let csvContent = "";
        try {
            csvContent = fs.readFileSync(partitionsPath, 'utf8');
        } catch (error) {
            return { url: baseUrl, error: "Unable to read partitions.csv." };
        }

        if (!csvContent.trim()) {
            return { url: baseUrl, error: "partitions.csv is empty." };
        }

        const flashSizeMB = this.resolveFlashSizeMB(path.dirname(partitionsPath));
        if (!flashSizeMB) {
            return { url: baseUrl, error: "Flash size not found (FlashSize)." };
        }

        const encodedCsv = Buffer.from(csvContent, 'utf8').toString('base64');
        const partitionParam = `base64:${encodeURIComponent(encodedCsv)}`;
        const url = `${baseUrl}?flash=${flashSizeMB}&partitions=${partitionParam}`;
        return { url };
    }

    private findPartitionsCsv(): string | undefined {
        const buildPath = arduinoCLI.getBuildPath();
        const directPath = path.join(buildPath, "partitions.csv");
        if (fs.existsSync(directPath)) {
            return directPath;
        }

        const outputRoot = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput());
        if (!fs.existsSync(outputRoot)) {
            return undefined;
        }

        const candidates: { filePath: string; mtimeMs: number }[] = [];
        const rootCandidate = path.join(outputRoot, "partitions.csv");
        if (fs.existsSync(rootCandidate)) {
            candidates.push({ filePath: rootCandidate, mtimeMs: fs.statSync(rootCandidate).mtimeMs });
        }

        try {
            const entries = fs.readdirSync(outputRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                const candidate = path.join(outputRoot, entry.name, "partitions.csv");
                if (fs.existsSync(candidate)) {
                    candidates.push({ filePath: candidate, mtimeMs: fs.statSync(candidate).mtimeMs });
                }
            }
        } catch (error) {
            return undefined;
        }

        if (candidates.length === 0) {
            return undefined;
        }

        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return candidates[0].filePath;
    }

    private resolveFlashSizeMB(buildPath?: string): string | undefined {
        const buildOptionsFlashSize = this.getFlashSizeFromBuildOptions(buildPath);
        if (buildOptionsFlashSize) {
            return buildOptionsFlashSize;
        }

        return (
            this.getFlashSizeFromProfile() ??
            this.getFlashSizeFromProjectConfiguration()
        );
    }

    private getFlashSizeFromProfile(): string | undefined {
        if (arduinoYaml.status() !== PROFILES_STATUS.ACTIVE) {
            return undefined;
        }

        const profileName = arduinoYaml.getProfileName();
        const profile = profileName ? arduinoYaml.getProfile(profileName) : undefined;
        return this.extractFlashSize(profile?.fqbn);
    }

    private getFlashSizeFromProjectConfiguration(): string | undefined {
        return this.extractFlashSize(arduinoProject.getBoardConfiguration());
    }

    private getFlashSizeFromBuildOptions(buildPath?: string): string | undefined {
        const rootPath = buildPath ?? arduinoCLI.getBuildPath();
        const buildOptionsPath = path.join(rootPath, "build.options.json");
        if (!fs.existsSync(buildOptionsPath)) {
            return undefined;
        }

        try {
            const buildOptions = JSON.parse(fs.readFileSync(buildOptionsPath, 'utf8'));
            const candidates = [
                buildOptions["build.flash_size"],
                buildOptions["upload.flash_size"],
                buildOptions["flash_size"],
                buildOptions["build.flashSize"],
                buildOptions["upload.flashSize"],
            ];

            for (const candidate of candidates) {
                const normalized = this.normalizeFlashSize(candidate);
                if (normalized) {
                    return normalized;
                }
            }

            const fqbn = buildOptions["build.fqbn"] || buildOptions["build.fqbn_name"];
            if (typeof fqbn === "string") {
                return this.extractFlashSize(fqbn);
            }
        } catch (error) {
            return undefined;
        }

        return undefined;
    }

    private extractFlashSize(source?: string): string | undefined {
        if (!source) {
            return undefined;
        }

        const match = source.match(/FlashSize=([^,]+)/i) || source.match(/flash_size=([^,]+)/i);
        if (!match) {
            return undefined;
        }

        return this.normalizeFlashSize(match[1]);
    }

    private normalizeFlashSize(value: unknown): string | undefined {
        if (value === undefined || value === null) {
            return undefined;
        }

        if (typeof value === "number") {
            return this.formatFlashSize(value);
        }

        if (typeof value !== "string") {
            return undefined;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }

        const match = trimmed.match(/(\d+(?:\.\d+)?)/);
        if (!match) {
            return undefined;
        }

        const numeric = Number.parseFloat(match[1]);
        if (!Number.isFinite(numeric)) {
            return undefined;
        }

        let mb = numeric;
        if (/gb/i.test(trimmed)) {
            mb = numeric * 1024;
        } else if (/kb/i.test(trimmed)) {
            mb = numeric / 1024;
        }

        return this.formatFlashSize(mb);
    }

    private formatFlashSize(mb: number): string | undefined {
        if (!Number.isFinite(mb) || mb <= 0) {
            return undefined;
        }

        const rounded = Math.round(mb);
        if (Math.abs(mb - rounded) < 0.0001) {
            return String(rounded);
        }

        return mb.toFixed(2).replace(/\.?0+$/, "");
    }

    private async decodeEsp32Backtrace(log: string): Promise<BacktraceDecodeResult> {
        if (!log || !log.trim()) {
            return { frames: [], error: "Paste a crash log to decode." };
        }

        const { addresses, pc } = this.extractBacktraceAddresses(log);
        if (addresses.length === 0 && !pc) {
            return { frames: [], error: "No backtrace addresses found in the log." };
        }

        const elfPath = this.findNewestElf();
        if (!elfPath) {
            return { frames: [], error: "No ELF file found in the build output." };
        }

        const dataDir = await this.getArduinoDataDirectory();
        if (!dataDir) {
            return { frames: [], error: "Arduino data directory not found." };
        }

        const chipId = this.resolveEsp32ChipId();
        if (!chipId) {
            return { frames: [], error: "Unable to resolve ESP32 target from the current board/profile." };
        }

        const arch = this.resolveEsp32Arch(chipId);
        if (!arch) {
            return { frames: [], error: "Unsupported ESP32 target for backtrace decoding." };
        }

        const addr2linePath = this.findAddr2LineBinary(dataDir, chipId, arch);
        if (!addr2linePath) {
            return { frames: [], error: "addr2line tool not found. Install ESP32 toolchains via the Arduino board manager." };
        }

        arduinoExtensionChannel.appendLine("ESP32 Backtrace Decoder:");
        arduinoExtensionChannel.appendLine(`ELF: ${elfPath}`);
        arduinoExtensionChannel.appendLine(`addr2line: ${addr2linePath}`);

        try {
            const output = await this.runAddr2Line(addr2linePath, elfPath, pc, addresses);
            const frames = this.parseAddr2LineOutput(output);
            this.logBacktraceFrames(frames);
            return { frames, elfPath, addr2linePath, arch };
        } catch (error: any) {
            const errorMessage = error?.message || "Failed to run addr2line.";
            arduinoExtensionChannel.appendLine(`ESP32 Backtrace Decoder error: ${errorMessage}`);
            return { frames: [], elfPath, addr2linePath, arch, error: errorMessage };
        }
    }

    private extractBacktraceAddresses(log: string): { addresses: string[]; pc?: string } {
        const addresses: string[] = [];
        const seen = new Set<string>();
        const addressRegex = /0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/g;
        let match: RegExpExecArray | null;
        while ((match = addressRegex.exec(log)) !== null) {
            const addr = match[0].split(':')[0];
            if (!seen.has(addr)) {
                seen.add(addr);
                addresses.push(addr);
            }
        }

        let pc: string | undefined;
        const pcMatch = log.match(/(?:^|\s)PC\s*[:=]?\s*(0x[0-9a-fA-F]+)/mi)
            || log.match(/PC\s+0x[0-9a-fA-F]+/mi);
        if (pcMatch) {
            const direct = pcMatch[1];
            if (direct) {
                pc = direct;
            } else {
                const found = pcMatch[0].match(/0x[0-9a-fA-F]+/);
                pc = found ? found[0] : undefined;
            }
        }

        return { addresses, pc };
    }

    private findNewestElf(): string | undefined {
        const buildPath = arduinoCLI.getBuildPath();
        const elfInBuild = this.findNewestElfInFolder(buildPath);
        if (elfInBuild) {
            return elfInBuild;
        }

        const outputRoot = path.join(arduinoProject.getProjectPath(), arduinoProject.getOutput());
        return this.findNewestElfInFolder(outputRoot, true);
    }

    private findNewestElfInFolder(folder: string, includeSubfolders: boolean = false): string | undefined {
        if (!fs.existsSync(folder)) {
            return undefined;
        }

        const candidates: { filePath: string; mtimeMs: number }[] = [];
        const scan = (dir: string, depth: number) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (includeSubfolders && depth < 2) {
                        scan(fullPath, depth + 1);
                    }
                    continue;
                }
                if (entry.isFile() && entry.name.toLowerCase().endsWith('.elf')) {
                    candidates.push({ filePath: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
                }
            }
        };

        try {
            scan(folder, 0);
        } catch {
            return undefined;
        }

        if (candidates.length === 0) {
            return undefined;
        }

        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return candidates[0].filePath;
    }

    private async getArduinoDataDirectory(): Promise<string | undefined> {
        try {
            const json = await arduinoCLI.getArduinoConfig();
            const config = JSON.parse(json);
            return config?.config?.directories?.data;
        } catch {
            return undefined;
        }
    }

    private resolveEsp32ChipId(): string | undefined {
        if (arduinoYaml.status() === PROFILES_STATUS.ACTIVE) {
            const profileName = arduinoYaml.getProfileName();
            const profile = profileName ? arduinoYaml.getProfile(profileName) : undefined;
            const chip = this.extractChipFromFqbn(profile?.fqbn);
            if (chip) {
                return chip;
            }
        }

        return this.extractChipFromFqbn(arduinoProject.getBoard());
    }

    private extractChipFromFqbn(fqbn?: string): string | undefined {
        if (!fqbn || typeof fqbn !== "string") {
            return undefined;
        }
        const parts = fqbn.split(':');
        if (parts.length >= 3) {
            return parts[2].toLowerCase();
        }
        return undefined;
    }

    private resolveEsp32Arch(chipId: string): "xtensa" | "riscv" | undefined {
        const riscv = new Set(["esp32c2", "esp32c3", "esp32c6", "esp32h2"]);
        if (riscv.has(chipId)) {
            return "riscv";
        }
        if (chipId.startsWith("esp32")) {
            return "xtensa";
        }
        return undefined;
    }

    private findAddr2LineBinary(dataDir: string, chipId: string, arch: "xtensa" | "riscv"): string | undefined {
        const toolsRoot = path.join(dataDir, "packages", "esp32", "tools");
        if (!fs.existsSync(toolsRoot)) {
            return undefined;
        }

        const exeSuffix = os.platform() === "win32" ? ".exe" : "";
        const candidates = arch === "riscv"
            ? [`riscv32-esp-elf-addr2line${exeSuffix}`]
            : [
                `xtensa-esp32-elf-addr2line${exeSuffix}`,
                `xtensa-${chipId}-elf-addr2line${exeSuffix}`,
                `xtensa-esp32s2-elf-addr2line${exeSuffix}`,
                `xtensa-esp32s3-elf-addr2line${exeSuffix}`,
            ];

        return this.findBestToolMatch(toolsRoot, candidates);
    }

    private findBestToolMatch(root: string, candidates: string[]): string | undefined {
        const candidateIndex = new Map<string, number>();
        candidates.forEach((name, index) => {
            candidateIndex.set(name.toLowerCase(), index);
        });

        const matches: { filePath: string; mtimeMs: number; name: string }[] = [];
        const stack: string[] = [root];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }
            let entries: any[];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                } else if (entry.isFile()) {
                    const entryName = entry.name.toLowerCase();
                    if (candidateIndex.has(entryName)) {
                        matches.push({
                            filePath: fullPath,
                            mtimeMs: fs.statSync(fullPath).mtimeMs,
                            name: entryName,
                        });
                    }
                }
            }
        }

        if (matches.length === 0) {
            return undefined;
        }

        matches.sort((a, b) => {
            const indexA = candidateIndex.get(a.name) ?? candidates.length;
            const indexB = candidateIndex.get(b.name) ?? candidates.length;
            if (indexA !== indexB) {
                return indexA - indexB;
            }
            return b.mtimeMs - a.mtimeMs;
        });

        return matches[0].filePath;
    }

    private runAddr2Line(addr2linePath: string, elfPath: string, pc: string | undefined, addresses: string[]): Promise<string> {
        const args = ["-fip", "-e", elfPath];
        if (pc) {
            args.push(pc);
        }
        args.push(...addresses);

        return new Promise((resolve, reject) => {
            const child = cp.spawn(addr2linePath, args);
            let outputBuffer = "";
            let errorBuffer = "";

            child.stdout.on("data", (data: Buffer) => {
                outputBuffer += data.toString();
            });

            child.stderr.on("data", (data: Buffer) => {
                errorBuffer += data.toString();
            });

            child.on("close", (code: number) => {
                if (code === 0) {
                    resolve(outputBuffer);
                } else {
                    reject(new Error(errorBuffer || `addr2line exited with code ${code}.`));
                }
            });

            child.on("error", (err: any) => {
                reject(err);
            });
        });
    }

    private parseAddr2LineOutput(output: string): BacktraceDecodeFrame[] {
        const frames: BacktraceDecodeFrame[] = [];
        const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            const parsed = this.parseAddr2LineLine(line);
            if (parsed) {
                frames.push(parsed);
                continue;
            }

            if (index + 1 < lines.length) {
                const paired = this.parseAddr2LinePair(line, lines[index + 1]);
                if (paired) {
                    frames.push(paired);
                    index += 1;
                }
            }
        }
        return frames;
    }

    private parseAddr2LineLine(line: string): BacktraceDecodeFrame | undefined {
        const trimmed = line.trim();
        const atIndex = trimmed.lastIndexOf(" at ");
        if (atIndex === -1) {
            return undefined;
        }

        const left = trimmed.slice(0, atIndex).trim();
        const right = trimmed.slice(atIndex + 4).trim();

        let address = "";
        let functionName = left;
        const addressMatch = left.match(/^(0x[0-9a-fA-F]+):\s*(.*)$/);
        if (addressMatch) {
            address = addressMatch[1];
            functionName = addressMatch[2] || "";
        }

        const cleaned = right.replace(/\s+\(inlined by\).*/, "");
        const lastColon = cleaned.lastIndexOf(":");
        if (lastColon === -1) {
            return {
                address: address || undefined,
                functionName: functionName || "??",
                file: cleaned || "??",
                line: 0,
            };
        }

        const file = cleaned.slice(0, lastColon) || "??";
        const lineStr = cleaned.slice(lastColon + 1);
        const lineNumber = Number.parseInt(lineStr, 10);

        return {
            address: address || undefined,
            functionName: functionName || "??",
            file,
            line: Number.isFinite(lineNumber) ? lineNumber : 0,
        };
    }

    private parseAddr2LinePair(functionLine: string, locationLine: string): BacktraceDecodeFrame | undefined {
        const functionName = functionLine.trim();
        if (!functionName) {
            return undefined;
        }

        const cleaned = locationLine.trim();
        const lastColon = cleaned.lastIndexOf(":");
        if (lastColon === -1) {
            return {
                functionName: functionName || "??",
                file: cleaned || "??",
                line: 0,
            };
        }

        const file = cleaned.slice(0, lastColon) || "??";
        const lineStr = cleaned.slice(lastColon + 1);
        const lineNumber = Number.parseInt(lineStr, 10);

        return {
            functionName: functionName || "??",
            file,
            line: Number.isFinite(lineNumber) ? lineNumber : 0,
        };
    }

    private logBacktraceFrames(frames: BacktraceDecodeFrame[]) {
        if (frames.length === 0) {
            arduinoExtensionChannel.appendLine("ESP32 Backtrace Decoder: no frames resolved.");
            return;
        }

        frames.forEach((frame) => {
            const location = frame.file && frame.line > 0 ? `${frame.file}:${frame.line}` : frame.file || "??";
            const address = frame.address ? `${frame.address} ` : "";
            const functionName = frame.functionName || "??";
            arduinoExtensionChannel.appendLine(`${address}${functionName} at ${location}`);
        });
    }

    private async openFileAtLocation(payload: { file?: string; line?: number; beside?: boolean }) {
        if (!payload || !payload.file || payload.file === "??") {
            window.showErrorMessage("No file path available for this frame.");
            return;
        }

        const line = payload.line && payload.line > 0 ? payload.line : 1;
        try {
            const fileUri = Uri.file(payload.file);
            const document = await workspace.openTextDocument(fileUri);
            const editor = await window.showTextDocument(document, {
                preview: true,
                viewColumn: payload.beside ? ViewColumn.Beside : undefined
            });
            const position = new Position(line - 1, 0);
            editor.selection = new Selection(position, position);
            editor.revealRange(new Range(position, position));
        } catch (error) {
            window.showErrorMessage(`Failed to open file: ${payload.file}`);
        }
    }

    public static sendMessage(message: WebviewToExtensionMessage) {
        if (VueWebviewPanel.currentPanel) {
            VueWebviewPanel.currentPanel._panel.webview.postMessage(message);
            // arduinoExtensionChannel.appendLine(`Message to vue app: ${message.payload}`);
        } else {
            arduinoExtensionChannel.appendLine("Attempted to send message, but the webview panel is not active.");
        }
    }

    public static render(context: ExtensionContext) {

        if (VueWebviewPanel.currentPanel) {
            VueWebviewPanel.currentPanel._panel.reveal(ViewColumn.One);
        } else {
            const panel = window.createWebviewPanel(
                'vueWebview',
                'Arduino Maker Workshop',
                ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        Uri.joinPath(context.extensionUri, "build"),
                        Uri.joinPath(context.extensionUri, "vue_webview/dist"),
                        Uri.joinPath(context.extensionUri, "resources")

                    ],
                }
            );

            panel.iconPath = Uri.file(
                path.join(context.extensionPath, 'resources', 'arduino_color.svg')
            );

            VueWebviewPanel.currentPanel = new VueWebviewPanel(panel, context.extensionUri);
            changeTheme(window.activeColorTheme.kind);
        }
    }

    public dispose() {
        VueWebviewPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getWebviewContent(webview: Webview, extensionUri: Uri) {
        const stylesUri = getUri(webview, extensionUri, ["vue_webview", "dist", "assets", "index.css"]);
        const scriptUri = getUri(webview, extensionUri, ["vue_webview", "dist", "assets", "index.js"]);

        const nonce = getNonce();

        const hmltcontent = /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            img-src ${webview.cspSource} https: data:;
            font-src ${webview.cspSource} https: data:;
            style-src ${webview.cspSource} 'unsafe-inline';
            script-src 'nonce-${nonce}';
            connect-src ${webview.cspSource} https:;
            ">
            <link rel="stylesheet"type="text/css" href="${stylesUri}">
            <title>Arduino</title>
        </head>
        <body>
            <div id="app"></div>
            <script nonce="${nonce}">
                window.cspNonce = '${nonce}';
            </script>
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `;
        return hmltcontent;
    }
}

export function sendBuildProfiles() {
    const message: WebviewToExtensionMessage = {
        command: ARDUINO_MESSAGES.GET_BUILD_PROFILES,
        errorMessage: "",
        payload: ""
    }
    const yaml = arduinoYaml.getYaml();
    let sketchProject: SketchProjectFile;
    if (arduinoYaml.getLastError()) {
        sketchProject = {
            error: arduinoYaml.getLastError(),
            buildProfileStatus: arduinoYaml.status()
        };
        message.payload = sketchProject;
        VueWebviewPanel.sendMessage(message);
    } else {
        if (yaml) {
            sketchProject = {
                yaml: yaml,
                error: "",
                buildProfileStatus: arduinoYaml.status()
            };
            message.payload = sketchProject;
            VueWebviewPanel.sendMessage(message);
        } else {
            sketchProject = {
                error: "",
                buildProfileStatus: arduinoYaml.status()
            };
            message.payload = sketchProject;
            VueWebviewPanel.sendMessage(message);
        }

    }
    updateStateCompileUpload();
}
