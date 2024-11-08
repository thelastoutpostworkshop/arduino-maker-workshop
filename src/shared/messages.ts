// Define the types of messages your extension and webview can exchange

export interface WebviewToExtensionMessage {
  command: string;
  errorMessage: string,
  payload: any | ArduinoProjectInfoPayload | ArduinoCLIStatus | ArduinoBoardsListPayload;
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
  deprecated?: boolean;
  boards: Board[];
  name?:string;
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

export interface CorePlatforms {
  platforms: Platform[];
}

export interface PlatformsList {
  boards: BoardList[];
}

export interface BoardList {
  name: string;
  fqbn: string;
  platform: PlatformData;
}

export interface PlatformData {
  metadata: Metadata;
  release: ReleaseData;
}

export interface Metadata {
  id: string;
  maintainer: string;
  website: string;
  email: string;
  indexed?: boolean;
}

export interface ReleaseData {
  name: string;
  version: string;
  types: string[];
  installed: boolean;
  boards: Board[];
  help: Help;
  compatible: boolean;
}

// Library
export interface Liblist {
  installed_libraries: InstalledLibrary[];
}

export interface InstalledLibrary {
  library: Library;
  release?: Release;
}

export interface Library {
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
  properties: CompatibleWith;
  location: string;
  layout: string;
  examples?: string[];
  provides_includes: string[];
  compatible_with: CompatibleWith;
}

export interface CompatibleWith {
}


export interface Release {
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

export interface Libsearch {
  libraries: LibraryAvailable[];
  status: string;
}

export interface LibraryAvailable {
  name: string;
  releases: Releases;
  latest: LatestLibrary;
  available_versions: string[];
}

export interface LatestLibrary {
  author: string;
  version: string;
  maintainer: string;
  sentence: string;
  website: string;
  category: string;
  architectures?: string[];
  types: string[];
  resources: LibraryResources;
  provides_includes?: string[];
  dependencies?: LibraryDependency[];
  paragraph?: string;
  license?: string;
}

export interface LibraryDependency {
  name: string;
  version_constraint?: string;
}

export interface LibraryResources {
  url: string;
  archive_filename: string;
  checksum: string;
  size: number;
  cache_path: string;
}

export interface Releases {
}

// Board connected
export interface BoardConnected {
  detected_ports: DetectedPort[];
}

export interface DetectedPort {
  port: Port;
}

export interface Port {
  address?:        string;
  label?:          string;
  protocol?:       string;
  protocol_label?: string;
  properties?:     Properties;
  hardware_id?:   string;
}

export interface Properties {
  pid?:          string;
  serialNumber?: string;
  vid?:          string;
}

export const ARDUINO_MESSAGES = {
  CLI_STATUS: 'getArduinoCLIStatus',
  ARDUINO_PROJECT_STATUS: 'getArduinoProjectStatus',
  ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',
  BOARD_CONFIGURATION: 'getArduinoBoardConfiguration',
  BOARDS_LIST_ALL: 'getArduinoBoardsListAll',
  BOARD_CONNECTED: 'getBoardConnected',
  SET_BOARD: 'setArduinoBoard',
  SET_BOARD_CONFIGURATION: 'setArduinoBoardConfiguration',
  SET_PORT:'setArduinoPort',
  OUTDATED: 'checkArduinoOutdated',
  INSTALL_CORE_VERSION: 'installCoreVersion',
  CORE_VERSION_INSTALLED: 'coreVersionInstalled',
  UNINSTALL_CORE:'uninstallCore',
  CORE_UNINSTALLED:'coreUninstalled',
  CORE_SEARCH: 'coreSearch',
  LIBRARY_SEARCH: 'librarySearch',
  LIBRARY_INSTALLED: 'libraryInstalled'
};
