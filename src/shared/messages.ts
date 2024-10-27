// Define the types of messages your extension and webview can exchange

export interface WebviewToExtensionMessage {
  command: string;
  errorMessage: string,
  payload: any | ArduinoBoardConfigurationPayload | ArduinoProjectInfoPayload | ArduinoCLIStatus | ArduinoBoardsListPayload;
}

export interface ArduinoBoardConfigurationPayload {
  errorMessage: string;
  boardConfiguration: BoardConfiguration | null;
}

export interface ArduinoConfiguration {
  port: string;
  configuration: string;
  output: string;
  board: string;
};

export interface ArduinoCLIStatus {
  version: string;
  date: string;
}

export interface ArduinoBoardsListPayload {
  errorMessage: string;
  boardStructure: any;
}

export interface ArduinoProjectInfoPayload {
  errorMessage: string;
  configuration: string;
  board: string;
  sketch: string;
  output: string;
  port: string;
}

export interface BoardConfiguration {
  fqbn: string;
  name: string;
  version: string;
  config_options: ConfigOption[];
  programmers: Programmer[];
}

export interface ConfigOptionValue {
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

export interface Platform {
  id: string;
  maintainer: string;
  website: string;
  email: string;
  indexed: boolean;
  releases: Record<string, Release>;
  installed_version: string;
  latest_version: string;
  deprecated?:boolean;
  boards: Board[];
}

export interface Release {
  name: string;
  version: string;
  types: string[];
  boards: Board[];
  help: Help;
  compatible: boolean;
  installed?: boolean;
}

export interface Board {
  name: string;
  fqbn?: string;
}

export interface boards {
  name: string;
  fqbn: string;
  platform: Platform;
}

interface Help {
  online: string;
}

interface LibraryData {
  library: Library;
  release: ReleaseDetails;
}

interface Library {
  name: string;
  author: string;
  maintainer: string;
  sentence: string;
  paragraph: string;
  website: string;
  category: string;
  architectures: string[];
  install_dir: string;
  source_dir: string;
  version: string;
  license: string;
  properties: Record<string, unknown>;
  location: string;
  layout: string;
  examples: string[];
  provides_includes: string[];
  compatible_with: Record<string, unknown>;
}

interface ReleaseDetails {
  author: string;
  version: string;
  maintainer: string;
  sentence: string;
  paragraph: string;
  website: string;
  category: string;
  architectures: string[];
  types: string[];
}

export interface OutdatedInformation {
  platforms: Platform[];
  libraries: LibraryData[];
}

export interface CorePlatforms {
  platforms:Platform[];
}

export interface PlatformsList {
  boards: BoardList[];
}

export interface BoardList {
  name:     string;
  fqbn:     string;
  platform: PlatformData;
}

export interface PlatformData {
  metadata: Metadata;
  release:  ReleaseData;
}

export interface Metadata {
  id:         string;
  maintainer: string;
  website:    string;
  email:      string;
  indexed?:   boolean;
}

export interface ReleaseData {
  name:       string;
  version:    string;
  types:      string[];
  installed:  boolean;
  boards:     Board[];
  help:       Help;
  compatible: boolean;
}

export const ARDUINO_MESSAGES = {
  CLI_STATUS: 'getArduinoCLIStatus',
  ARDUINO_PROJECT_STATUS: 'getArduinoProjectStatus',
  ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',
  BOARD_CONFIGURATION: 'getArduinoBoardConfiguration',
  BOARDS_LIST_ALL: 'getArduinoBoardsListAll',
  SET_BOARD: 'setArduinoBoard',
  SET_BOARD_CONFIGURATION: 'setArduinoBoardConfiguration',
  OUTDATED: 'checkArduinoOutdated',
  INSTALL_CORE_VERSION: 'installCoreVersion',
  CORE_SEARCH: 'coreSearch'
};
