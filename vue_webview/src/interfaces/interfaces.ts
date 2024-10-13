export interface BoardInfo {
    fqbn: string;
    name: string;
    version: string;
    config_options: ConfigOption[];
    programmers: Programmer[];
}

interface ConfigOptionValue {
    value: string;
    value_label: string;
    selected?: boolean;
}

interface ConfigOption {
    option: string;
    option_label: string;
    values: ConfigOptionValue[];
}

interface Programmer {
    platform: string;
    id: string;
    name: string;
}
