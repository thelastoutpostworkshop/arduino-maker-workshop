import { arduinoCLI } from "./extension";
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
}