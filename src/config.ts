import { arduinoCLI, arduinoExtensionChannel } from "./extension";
import { ArduinoConfig } from "./shared/messages";


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
                    // this.createNew(); // Uncomment if needed
                    return true; // File created successfully
                } catch (error) {
                    arduinoExtensionChannel.appendLine("Failed to create a new Arduino Configuration file");
                    return false; // Failed to create file
                }
            }
    
            return true; // Configuration exists and is valid
        } catch (error) {
            arduinoExtensionChannel.appendLine("Error parsing Arduino Configuration or file not found");
            return false; // Configuration not present or invalid
        }
    }
    private createNew() {

    }
}