export interface WebviewToExtensionMessage {
  command: string;
  errorMessage: string,
  payload: any  | ArduinoProjectStatus ;
}

export interface ArduinoConfiguration {
  port: string;
  configuration: string;
  output: string;
  board: string;
};

export enum ARDUINO_ERRORS {
  NO_ERRORS,
  NO_INO_FILES,
  WRONG_FOLDER_NAME,
  INTERNAL
}

export interface ArduinoProjectStatus {
  cli_status:ArduinoCLIStatus;
  project_status:ARDUINO_ERRORS;
}

export interface ArduinoCLIStatus {
  Application?:   string;
  VersionString: string;
  Commit?:        string;
  Status?:        string;
  Date:          string;
}

export interface Outdated {
  platforms: any;
  libraries: any;
}

// Compile output interfaces
export interface Compile {
  compiler_out:   string;
  compiler_err:   string;
  builder_result: BuilderResult;
  upload_result:  UploadResult;
  success:        boolean;
}

export interface BuilderResult {
  build_path:               string;
  used_libraries:           UsedLibrary[];
  executable_sections_size: ExecutableSectionsSize[];
  board_platform:           DPlatform;
  build_platform:           DPlatform;
  build_properties:         string[];
}

export interface DPlatform {
  id:          string;
  version:     string;
  install_dir: string;
  package_url: string;
}

export interface ExecutableSectionsSize {
  name:     string;
  size:     number;
  max_size: number;
}

export interface UsedLibrary {
  name:                string;
  author:              string;
  maintainer:          string;
  sentence:            string;
  paragraph?:          string;
  website?:            string;
  category:            string;
  architectures:       string[];
  install_dir:         string;
  source_dir:          string;
  version:             string;
  license:             string;
  properties:          UploadResult;
  location:            string;
  layout:              string;
  examples?:           string[];
  provides_includes:   string[];
  compatible_with:     UploadResult;
  container_platform?: string;
}

export interface UploadResult {
}
// Boards interfacesà
//
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
  name?: string;
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

// Library interfaces
//
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
  installedVersion?: string;
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

// Board connected interfaces
//
export interface BoardConnected {
  detected_ports: DetectedPort[];
}

// Port interfaces
//
export interface DetectedPort {
  port: Port;
}

export interface Port {
  address?: string;
  label?: string;
  protocol?: string;
  protocol_label?: string;
  properties?: Properties;
  hardware_id?: string;
}

export interface Properties {
  pid?: string;
  serialNumber?: string;
  vid?: string;
}

export const ARDUINO_MESSAGES = {
  CLI_BOARD_OPTIONS: 'cli_getArduinoBoardOptions',
  CLI_BOARD_SEARCH: 'cli_getArduinoBoardSearch',
  CLI_BOARD_CONNECTED: 'cli_getBoardConnected',
  CLI_UPDATE_INDEX: 'cli_updateArduinoIndexCoresAndLibraries',
  CLI_INSTALL_CORE_VERSION: 'cli_installCoreVersion',
  CLI_UNINSTALL_CORE: 'cli_uninstallCore',
  CLI_CORE_SEARCH: 'cli_coreSearch',
  CLI_LIBRARY_SEARCH: 'cli_librarySearch',
  CLI_CREATE_NEW_SKETCH: 'cli_arduinoNewSketch',
  CLI_INSTALL_LIBRARY: 'cli_InstallLibrary',
  CLI_UNINSTALL_LIBRARY: 'cli_UnInstallLibrary',
  CLI_LIBRARY_INSTALLED: 'cli_libraryInstalled',
  CLI_OUTDATED:'cli_outdated',
  ARDUINO_PROJECT_STATUS: 'getArduinoProjectStatus',
  ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',
  SET_BOARD: 'setArduinoBoard',
  SET_BOARD_OPTIONS: 'setArduinoBoardOptions',
  SET_PORT: 'setArduinoPort',
  CORE_VERSION_INSTALLED: 'coreVersionInstalled',
  CORE_UNINSTALLED: 'coreUninstalled',
  LIBRARY_VERSION_INSTALLED: 'libraryVersionInstalled',
  LIBRARY_UNINSTALLED: 'libraryVersionInstalled',
  SET_ADDITIONAL_URLS: 'setAdditionalURLs',
  GET_ADDITIONAL_URLS: 'getAdditionalURLs',
  OPEN_LIBRARY:'openExample',
  REQUEST_BOARD_CONNECTED:"requestBoardConnected"
};
