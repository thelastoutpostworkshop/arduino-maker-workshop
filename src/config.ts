import { read } from "fs";
import { arduinoCLI, arduinoExtensionChannel } from "./extension";
import { ArduinoConfig } from "./shared/messages";
const path = require('path');
const os = require('os');

const staging = 'staging';
const arduino = 'Arduino';

export class ArduinoConfiguration {
    private _config: ArduinoConfig | null = null;
    constructor() {

    }
    public async verify(): Promise<boolean> {
        return this.isPresent();
    }
    private async readConfig() {
        const json = await arduinoCLI.getArduinoConfig();
        this._config = JSON.parse(json);
    }
    private async isPresent(): Promise<boolean> {
        try {
            const json = await arduinoCLI.getArduinoConfig();
            const parsedConfig: ArduinoConfig = JSON.parse(json);

            // Ensure parsedConfig is valid before assigning
            if (parsedConfig && Object.keys(parsedConfig.config).length > 0) {
                this._config = parsedConfig;
                return true;
            }

            // Handle case where config is empty
            arduinoExtensionChannel.appendLine("Creating new Arduino Configuration file");
            try {
                await this.createNew();
                return true;
            } catch (error) {
                arduinoExtensionChannel.appendLine("Failed to create a new Arduino Configuration file");
                return false;
            }
        } catch (error) {
            arduinoExtensionChannel.appendLine("Bad Arduino Configuration file");
            return false;
        }
    }

    private async createNew() {
        const initJson = await arduinoCLI.initArduinoConfiguration();
        const config = JSON.parse(initJson);
        const configPath = path.dirname(config.config_path);
        const downloadPath = path.join(configPath, staging);
        const arduinoDir = path.join(this.getDocumentsFolderPath(), arduino);
        await arduinoCLI.setConfigDownloadDirectory(downloadPath);
        await arduinoCLI.setConfigDataDirectory(configPath);
        await arduinoCLI.setConfigUserDirectory(arduinoDir);
        await this.readConfig();
    }
    private getDocumentsFolderPath() {
        const homeDir = os.homedir(); // Get the user's home directory

        switch (os.platform()) {
            case 'win32':
                return path.join(homeDir, 'Documents'); // Windows path to Documents
            case 'linux':
            case 'darwin':
                return path.join(homeDir, 'Documents'); // Linux and macOS path to Documents
            default:
                throw new Error('Unsupported platform');
        }
    }
}