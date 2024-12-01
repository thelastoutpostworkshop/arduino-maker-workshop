import { arduinoCLI } from "./extension";


export class ArduinoConfiguration {
    constructor() {

    }
    public isPresent(): boolean {
        let res: boolean = false;
        arduinoCLI.getArduinoConfig().then(() => {
            res = true;
        }).catch(() => {
            res = false;
        });
        return res;
    }
}