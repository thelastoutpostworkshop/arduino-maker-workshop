import { arduinoCLI, arduinoExtensionChannel } from "./extension";
const path = require('path');
const os = require('os');

export class ArduinoConfiguration {
    constructor() {

    }
    public async verify(): Promise<boolean> {
        return this.isPresent();
    }
    private async isPresent(): Promise<boolean> {
        try {
            const json = await arduinoCLI.getArduinoConfig();
            const config = JSON.parse(json);

            if (Object.keys(config.config).length === 0) {
                try {
                    arduinoExtensionChannel.appendLine("Creating new Arduino Configuration file");
                    await this.createNew();

                    return true;
                } catch (error) {
                    arduinoExtensionChannel.appendLine("Failed to create a new Arduino Configuration file");
                    return false;
                }
            }

            return true;
        } catch (error) {
            arduinoExtensionChannel.appendLine("Bad Arduino Configuration file");
            return false;
        }
    }
    private async createNew() {
        const initJson = await arduinoCLI.initArduinoConfiguration();
        const config = JSON.parse(initJson);
        const configPath = path.dirname(config.config_path);
        const downloadPath = path.join(configPath, 'staging');
        const arduinoDir = path.join(this.getDocumentsFolderPath(), 'Arduino');
        await arduinoCLI.setConfigDownloadDirectory(downloadPath);
        await arduinoCLI.setConfigDataDirectory(configPath);
        await arduinoCLI.setConfigUserDirectory(arduinoDir);
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