import { arduinoCLI, arduinoExtensionChannel } from "./extension";
import { ArduinoConfig } from "./shared/messages";


export class ArduinoConfiguration {
    private config: ArduinoConfig;
    constructor() {

    }
    public verify(): boolean {
        if (!this.isPresent()) {
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
            return false;
        }
        return true;
    }
    private isPresent(): boolean {
        let res: boolean = false;
        arduinoCLI.getArduinoConfig().then((json) => {
            try {
                this.config = JSON.parse(json);
            } catch (error) {
                res = false;
            }
            res = true;
        }).catch(() => {
            res = false;
        });
        return res;
    }
    private createNew() {

    }
}