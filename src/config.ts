import { arduinoCLI, arduinoExtensionChannel } from "./extension";
import { ArduinoConfig } from "./shared/messages";


export class ArduinoConfiguration {
    private config: ArduinoConfig;
    constructor() {

    }
    public verify(): boolean {
        if (!this.isPresent()) {
 
            return false;
        }
        return true;
    }
    private isPresent(): boolean {
        arduinoCLI.getArduinoConfig().then((json) => {
            try {
                this.config = JSON.parse(json);
                if (Object.keys(this.config.config).length === 0) {
                    try {
                        arduinoExtensionChannel.appendLine("Creating new Arduino Configuration file");
                        // this.createNew();
                    } catch (error) {
                        arduinoExtensionChannel.appendLine("Failed to create a new Arduino Configuration file");
                        return false;
                    }
                }
            } catch (error) {
                return false;
            }
        }).catch(() => {
            return false;
        });
        return true;
    }
    private createNew() {

    }
}