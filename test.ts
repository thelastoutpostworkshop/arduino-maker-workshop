export interface Boards {
    boards: BoardsBoard[];
}

export interface BoardsBoard {
    name:     string;
    fqbn:     string;
    platform: Platform;
}

export interface Platform {
    metadata: Metadata;
    release:  Release;
}

export interface Metadata {
    id:         ID;
    maintainer: Maintainer;
    website:    string;
    email:      Email;
    indexed?:   boolean;
}

export enum Email {
    EarlephilhowerYahooCOM = "earlephilhower@yahoo.com",
    HristoEspressifCOM = "hristo@espressif.com",
    IvanEsp8266COM = "ivan@esp8266.com",
    PackagesArduinoCc = "packages@arduino.cc",
}

export enum ID {
    ArduinoAvr = "arduino:avr",
    ArduinoRenesasUno = "arduino:renesas_uno",
    Esp32Esp32 = "esp32:esp32",
    Esp8266Esp8266 = "esp8266:esp8266",
    Rp2040Rp2040 = "rp2040:rp2040",
}

export enum Maintainer {
    Arduino = "Arduino",
    ESP8266Community = "ESP8266 Community",
    EarleFPhilhowerIII = "Earle F. Philhower, III",
    EspressifSystems = "Espressif Systems",
}

export interface Release {
    name:       Name;
    version:    Version;
    types:      Type[];
    installed:  boolean;
    boards:     ReleaseBoard[];
    help:       Help;
    compatible: boolean;
}

export interface ReleaseBoard {
    name: string;
    fqbn: string;
}

export interface Help {
    online: string;
}

export enum Name {
    ArduinoAVRBoards = "Arduino AVR Boards",
    ArduinoUNOR4Boards = "Arduino UNO R4 Boards",
    Esp32 = "esp32",
    Esp8266 = "esp8266",
    RaspberryPiPicoRP2040RP2350 = "Raspberry Pi Pico/RP2040/RP2350",
}

export enum Type {
    Arduino = "Arduino",
    Esp32 = "ESP32",
    Esp8266 = "ESP8266",
    RaspberryPiPico = "Raspberry Pi Pico",
}

export enum Version {
    The121 = "1.2.1",
    The186 = "1.8.6",
    The304 = "3.0.4",
    The312 = "3.1.2",
    The403 = "4.0.3",
}
