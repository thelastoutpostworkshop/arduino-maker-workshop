import { defineStore } from 'pinia';
import { ARDUINO_MESSAGES, ArduinoCLIStatus, ArduinoProjectConfiguration, BoardConfiguration, WebviewToExtensionMessage, PlatformsList, CorePlatforms, Libsearch, Liblist, BoardConnected, ArduinoProjectStatus, Outdated, ArduinoConfig, LibraryInformation, THEME_COLOR } from '@shared/messages';
import { vscode } from '@/utilities/vscode';
import { useTheme } from 'vuetify';

async function loadMockData(mockFile: string, jsonToString: boolean = true): Promise<string> {
    try {
        const response = await fetch(`/mock/${mockFile}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${mockFile}: ${response.statusText}`);
        }
        const mockData = await response.json();
        if (jsonToString) {
            return JSON.stringify(mockData);
        } else {
            return mockData;
        }
    } catch (error) {
        console.error('Error loading mock data:', error);
        return '';
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useVsCodeStore = defineStore('vsCode', {
    state: () => ({
        cliStatus: null as ArduinoCLIStatus | null,
        projectInfo: null as ArduinoProjectConfiguration | null,
        projectStatus: null as ArduinoProjectStatus | null,
        boardOptions: null as BoardConfiguration | null,
        boards: null as PlatformsList | null,
        boardConnected: null as BoardConnected | null,
        platform: null as CorePlatforms | null,
        libraries: null as Libsearch | null,
        librariesInstalled: null as Liblist | null,
        libariesInformation: null as LibraryInformation[] | null,
        additionalBoardURLs: null as string | null,
        outdated: null as Outdated | null,
        cliConfig: null as ArduinoConfig | null,
        boardUpdating: "",
        libraryUpdating: ""
    }),
    actions: {
        async mockMessage(message: WebviewToExtensionMessage) {
            if (import.meta.env.DEV) {
                await sleep(1000);  // Simulate delay
                switch (message.command) {
                    case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                        loadMockData('coresearch.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_CONFIG_ADD_ADDITIONAL_URL:
                    case ARDUINO_MESSAGES.CLI_CONFIG_REMOVE_ADDITIONAL_URL:
                    case ARDUINO_MESSAGES.CLI_GET_CONFIG:
                        loadMockData('config.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                        loadMockData('libsearch.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                        loadMockData('libinstalled.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                        loadMockData('board_options.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                        loadMockData('arduino_configuration.json', false).then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                        loadMockData('project_status.json', false).then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                        loadMockData('board_search.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
                        loadMockData('board_connected.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_UPDATE_INDEX:
                        loadMockData('outdated.json').then((mockPayload) => {
                            message.payload = mockPayload;
                            this.handleMessage(message);
                        });
                        break;
                    case ARDUINO_MESSAGES.CLI_UNINSTALL_CORE:
                        message.command = ARDUINO_MESSAGES.CORE_UNINSTALLED;
                        this.handleMessage(message);
                        break;
                    case ARDUINO_MESSAGES.CLI_INSTALL_CORE_VERSION:
                        message.command = ARDUINO_MESSAGES.CORE_VERSION_INSTALLED;
                        this.handleMessage(message);
                        break;
                    case ARDUINO_MESSAGES.INSTALL_ZIP_LIBRARY:
                        message.command = ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED;
                        this.handleMessage(message);
                        break;
                    case ARDUINO_MESSAGES.CLI_INSTALL_LIBRARY:
                        message.command = ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED;
                        this.handleMessage(message);
                        break;
                    case ARDUINO_MESSAGES.CLI_UNINSTALL_LIBRARY:
                        message.command = ARDUINO_MESSAGES.LIBRARY_UNINSTALLED;
                        this.handleMessage(message);
                        break;
                    default:
                        break;
                }
            }
        },
        sendMessage(message: WebviewToExtensionMessage) {
            switch (message.command) {
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    if (this.projectStatus === null) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                    if (!this.platform) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_GET_CONFIG:
                    if (!this.cliConfig) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
                    if (!this.boardConnected) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                    if (!this.boards) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                    if (!this.libraries) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                    if (!this.librariesInstalled) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                    if (!this.boardOptions) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_UPDATE_INDEX:
                    if (!this.outdated) {
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.SET_PROGRAMMER:
                    if (this.projectInfo) {
                        this.projectInfo.programmer = message.payload;
                        vscode.postMessage(message);
                    }
                    break;
                case ARDUINO_MESSAGES.SET_USE_PROGRAMMER:
                    if (this.projectInfo) {
                        this.projectInfo.useProgrammer = message.payload;
                        vscode.postMessage(message);
                    }
                    break;
                default:
                    vscode.postMessage(message);
                    break;
            }
        },
        handleMessage(message: WebviewToExtensionMessage) {
            switch (message.command) {
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO:
                    this.projectInfo = message.payload;
                    if (this.projectInfo?.board) {
                        this.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_OPTIONS, errorMessage: "", payload: this.projectInfo.board });
                    }
                    break;
                case ARDUINO_MESSAGES.ARDUINO_PROJECT_STATUS:
                    this.projectStatus = message.payload;
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_OPTIONS:
                    try {
                        this.boardOptions = JSON.parse(message.payload);
                        this.boardOptions?.config_options.forEach((configOption) => {
                            configOption.values.forEach((value) => {
                                if (value.selected === undefined) {
                                    value.selected = false;
                                }
                            });
                        });
                        let configuration = this.boardOptions?.config_options
                            .map((configOption) => {
                                const selectedValue = configOption.values.find(value => value.selected);
                                if (selectedValue) {
                                    return `${configOption.option}=${selectedValue.value}`;
                                }
                                return null;
                            })
                            .filter((optionString) => optionString !== null) // Remove any null values from the array
                            .join(",");
                        this.sendMessage({ command: ARDUINO_MESSAGES.SET_BOARD_OPTIONS, errorMessage: "", payload: configuration });
                    } catch (error) {
                        this.boardOptions = null;
                        this.sendMessage({ command: ARDUINO_MESSAGES.ARDUINO_PROJECT_INFO, errorMessage: "", payload: "" });
                        console.log("Failed to parse Board Configuration information.");
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_SEARCH:
                    try {
                        this.boards = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse Board Configuration information: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_GET_CONFIG:
                    try {
                        this.cliConfig = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse CLI Configuration: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.REQUEST_BOARD_CONNECTED:
                    this.boardConnected = null;
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_BOARD_CONNECTED, errorMessage: "", payload: "" });
                    break;
                case ARDUINO_MESSAGES.CLI_BOARD_CONNECTED:
                    try {
                        this.boardConnected = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse Board Connected information: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_CORE_SEARCH:
                    try {
                        this.platform = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse core search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH:
                    try {
                        this.libraries = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse library search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED:
                    try {
                        this.librariesInstalled = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse library search response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.LIBRARY_UNINSTALLED:
                case ARDUINO_MESSAGES.LIBRARY_VERSION_INSTALLED:
                    this.libraryUpdating = "";
                    this.librariesInstalled = null;
                    this.libraries = null;
                    this.libariesInformation = null;
                    this.outdated = null;
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_SEARCH, errorMessage: "", payload: "" });
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_LIBRARY_INSTALLED, errorMessage: "", payload: "" });
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_UPDATE_INDEX, errorMessage: "", payload: "" });
                    break;
                case ARDUINO_MESSAGES.CORE_UNINSTALLED:
                case ARDUINO_MESSAGES.CORE_VERSION_INSTALLED:
                    this.boardUpdating = "";
                    this.platform = null;
                    this.outdated = null;
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_CORE_SEARCH, errorMessage: "", payload: "" });
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_UPDATE_INDEX, errorMessage: "", payload: "" });
                    break;
                case ARDUINO_MESSAGES.CLI_UPDATE_INDEX:
                    try {
                        this.outdated = JSON.parse(message.payload);
                    } catch (error) {
                        console.log("Failed to parse outdated response: " + error);
                    }
                    break;
                case ARDUINO_MESSAGES.CLI_CONFIG_ADD_ADDITIONAL_URL:
                case ARDUINO_MESSAGES.CLI_CONFIG_REMOVE_ADDITIONAL_URL:
                case ARDUINO_MESSAGES.CLI_CONFIG_SET_ADDITIONAL_URL:
                    this.cliConfig = null;
                    this.platform = null;
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_GET_CONFIG, errorMessage: "", payload: "" });
                    this.sendMessage({ command: ARDUINO_MESSAGES.CLI_CORE_SEARCH, errorMessage: "", payload: "" });
                    break;
                case ARDUINO_MESSAGES.CHANGE_THEME_COLOR:
                    const theme = useTheme();
                    switch (message.payload as THEME_COLOR) {
                        case THEME_COLOR.dark:
                            theme.global.name.value = 'dark';
                            break;
                            case THEME_COLOR.light:
                            theme.global.name.value = 'light';
                            break;
                        case THEME_COLOR.highContrast:
                            
                            break;
                    }
                    break;
                default:
                    console.warn('Unknown command received:', message.command);
            }
        },
    },
});