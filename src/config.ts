import { arduinoCLI } from "./extension";


export class ArduinoConfiguration {
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
        arduinoCLI.getArduinoConfig().then(() => {
            res = true;
        }).catch(() => {
            res = false;
        });
        return res;
    }
}