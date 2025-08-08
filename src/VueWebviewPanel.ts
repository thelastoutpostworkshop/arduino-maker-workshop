import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn, ExtensionContext } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { ARDUINO_ERRORS, ARDUINO_MESSAGES, PROFILES_STATUS, SketchProjectFile, WebviewToExtensionMessage } from './shared/messages';
import { arduinoCLI, arduinoExtensionChannel, arduinoProject, arduinoYaml, changeTheme, compile, loadArduinoConfiguration, openExample, shouldDetectPorts, updateStateCompileUpload } from "./extension";

const path = require('path');
const os = require('os');

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
                        Uri.joinPath(context.extensionUri, "vue_webview/dist")
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
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
