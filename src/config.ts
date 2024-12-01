import { arduinoCLI, arduinoExtensionChannel } from "./extension";
import { ArduinoConfig } from "./shared/messages";
const path = require('path');


export class ArduinoConfiguration {
    private config: ArduinoConfig;
    constructor() {

    }
    public async verify(): Promise<boolean> {
        return this.isPresent();
    }
    private async isPresent(): Promise<boolean> {
        try {
            const json = await arduinoCLI.getArduinoConfig();
            this.config = JSON.parse(json);

            if (Object.keys(this.config.config).length === 0) {
                try {
                    arduinoExtensionChannel.appendLine("Creating new Arduino Configuration file");
                    this.createNew(); 
                    return true; 
                } catch (error) {
                    arduinoExtensionChannel.appendLine("Failed to create a new Arduino Configuration file");
                    return false; 
                }
            }

            return true; 
        } catch (error) {
            arduinoExtensionChannel.appendLine("Error parsing Arduino Configuration or file not found");
            return false; 
        }
    }
    private async createNew() {
        const initJson = await arduinoCLI.getConfigInitArgs();
        const config = JSON.parse(initJson);
        const configPath = path.dirname(config.config_path);
        const downloadPath = path.join(configPath, 'staging');
    }
}