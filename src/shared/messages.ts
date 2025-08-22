import { MonitorPortSettings } from "@microsoft/vscode-serial-monitor-api";

export const ArduinoExtensionChannelName = 'Arduino Extension';
export const YAML_FILENAME = 'sketch.yaml';
export const YAML_FILENAME_INACTIVE = 'sketch.yaml.disabled';
export const NO_DEFAULT_PROFILE = '<none>';
export const NO_PROGRAMMER = '<none>';
export const DEFAULT_PROFILE = 'default_profile';
export const UNKNOWN_PROFILE = 'unknown_profile';
export const BUILD_NAME_PROFILE = 'build_';

// Message exchange with webciew
export interface WebviewToExtensionMessage {
  command: string;
  errorMessage: string,
  payload: any | ArduinoProjectStatus;
}

// Compile Result
export interface CompileResult {
  result: boolean
}

// Build Options
export interface BuildOptions {
  additionalFiles: string;
  customBuildProperties: string;
  fqbn: string;
  hardwareFolders: string;
  otherLibrariesFolders: string;
  sketchLocation: string;
}

// Arduino Config file interface
export interface ArduinoConfig {
  config: Config;
}

export interface Config {
  board_manager?: BoardManager;
  daemon?: Daemon;
  directories?: Directories;
  library?: Library;
  logging?: Logging;
  metrics?: Metrics;
  output?: Output;
  sketch?: Sketch;
  updater?: Updater;
}

export interface BoardManager {
  additional_urls: string[];
}

export interface Daemon {
  port: string;
}

export interface Directories {
  data: string;
  downloads: string;
  user: string;
}

export interface Library {
  enable_unsafe_install: boolean;
}

export interface Logging {
  file: string;
  format: string;
  level: string;
}

export interface Metrics {
  addr: string;
  enabled: boolean;
}

export interface Output {
  no_color: boolean;
}

export interface Sketch {
  always_export_binaries: boolean;
}

export interface Updater {
  enable_notification: boolean;
}

export interface PortSettings {
  port: string;
  baudRate: number;
  lineEnding: string;
  dataBits: number;
  parity: string;
  stopBits: string;
}

// Arduino Project Configuration
export interface ArduinoProjectConfiguration {
  port: string;
  configuration: string;
  configurationRequired: boolean;
  output: string;
  board: string;
  programmer: string;
  useProgrammer: boolean;
  optimize_for_debug: boolean;
  monitorPortSettings: MonitorPortSettings
  compile_profile: string
};

export enum ARDUINO_ERRORS {
  NO_ERRORS,
  NO_INO_FILES,
  WRONG_FOLDER_NAME,
  CLI_NOT_WORKING,
  CONFIG_FILE_PROBLEM,
  INTERNAL
}

export interface ArduinoProjectStatus {
  cli_status?: ArduinoCLIStatus;
  status: ARDUINO_ERRORS;
  folderName?: string;
  sketchName?: string;
}

export interface ArduinoCLIStatus {
  Application?: string;
  VersionString: string;
  Commit?: string;
  Status?: string;
  Date: string;
}

export interface Outdated {
  platforms: any;
  libraries: OutdatedLibraries[];
}

export interface OutdatedLibraries {
  library: Library;
  release: Release;
}

// Compile output interfaces
export interface Compile {
  compiler_out: string;
  compiler_err: string;
  builder_result: BuilderResult;
  upload_result: UploadResult;
  success: boolean;
}

export interface BuilderResult {
  build_path: string;
  used_libraries: UsedLibrary[];
  executable_sections_size: ExecutableSectionsSize[];
  board_platform: DPlatform;
  build_platform: DPlatform;
  build_properties: string[];
}

export interface DPlatform {
  id: string;
  version: string;
  install_dir: string;
  package_url: string;
}

export interface ExecutableSectionsSize {
  name: string;
  size: number;
  max_size: number;
}

export interface UsedLibrary {
  name: string;
  author: string;
  maintainer: string;
  sentence: string;
  paragraph?: string;
  website?: string;
  category: string;
  architectures: string[];
  install_dir: string;
  source_dir: string;
  version: string;
  license: string;
  properties: UploadResult;
  location: string;
  layout: string;
  examples?: string[];
  provides_includes: string[];
  compatible_with: UploadResult;
  container_platform?: string;
}

export interface UploadResult {
}
// Boards interfaces
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
export interface LibraryInformation {
  name: string;
  latestVersion: string;
  installedVersion: string;
  author: string;
  paragraph: string;
  sentence: string;
  website: string;
  dependencies: LibraryDependency[] | undefined;
  available_versions?: string[];
  zipLibrary: boolean;
  installed: boolean;
}

export interface Liblist {
  installed_libraries: InstalledLibrary[];
}

export interface InstalledLibrary {
  library: Library;
}

export interface Libsearch {
  libraries: LibraryAvailable[];
  status: string;
}

export interface LibraryAvailable {
  name: string;
  latest: Release;
  available_versions: string[];
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
  dependencies?: LibraryDependency[];
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

// Theme Color
//
export enum THEME_COLOR {
  dark,
  light,
  highContrast
}

// Build profiles base on the official Yaml Sketch Project
export enum PROFILES_STATUS {
  NOT_AVAILABLE = 'none',
  INACTIVE = 'inactive',
  ACTIVE = 'active'
}
export interface SketchProjectFile {
  yaml?: SketchYaml;
  error: string;
  buildProfileStatus: PROFILES_STATUS
}
export interface SketchYaml {
  profiles: Record<string, BuildProfile>;
  default_profile?: string;
}

export type ProfileLibraryEntry = string | { dir: string };

export interface BuildProfile {
  notes?: string;
  fqbn: string;
  programmer?: string;
  platforms?: PlatformDependencyProfile[];
  libraries?: ProfileLibraryEntry[];          
  port?: string;
  port_config?: Record<string, string>;
  protocol?: string;
}
export interface PlatformDependencyProfile {
  platform: string;
  platform_index_url?: string;
}

// Build profiles interfaces to send updated information on the build profile
export interface BuildProfileUpdate {
  profile_name: string;
  new_profile_name?: string;
  fqbn?: string;
  platforms?: PlatformDependencyProfile[];
  libraries?: ProfileLibraryEntry[];          
  notes?: string;
  port_settings?: PortSettings;
  programmer?: string;
}

// Messages exchanged between the extension and the webview
export const ARDUINO_MESSAGES = {
  // arduino-cli commands
  CLI_BOARD_OPTIONS: 'cli_getArduinoBoardOptions',
  CLI_BOARD_OPTIONS_PROFILE: 'cli_getProfileBoardOptions',
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
  CLI_LIBRARY_INSTALLATION_ERROR: 'cli_libraryInstallationError',
  CLI_GET_CONFIG: 'cli_getConfig',
  CLI_CONFIG_REMOVE_ADDITIONAL_URL: 'cli_congifRemoveAdditionnalUrl',
  CLI_CONFIG_ADD_ADDITIONAL_URL: 'cli_congifAddAdditionnalUrl',
  CLI_CONFIG_SET_ADDITIONAL_URL: 'cli_congifSetAdditionnalUrl',

  // project related commands
  ARDUINO_PROJECT_STATUS: 'getArduinoProjectStatus',
  ARDUINO_PROJECT_INFO: 'getArduinoProjectInfo',

  // configuration related commands
  SET_BOARD: 'setArduinoBoard',
  SET_BOARD_OPTIONS: 'setArduinoBoardOptions',
  SET_PORT: 'setArduinoPort',
  SET_MONITOR_PORT_SETTINGS: 'setMonitorPortSettings',
  SET_PROGRAMMER: 'setArduinoProgrammer',
  SET_USE_PROGRAMMER: 'setArduinoUseProgrammer',
  SET_OPTIMIZE_FOR_DEBUG: 'setOptimizeForDebug',
  SET_CONFIGURATION_REQUIRED: "SetConfigurationRequired",

  // Build profiles related commands
  SET_STATUS_BUILD_PROFILE: 'setStatusBuildProfile',
  CREATE_BUILD_PROFILE: 'createBuildProfile',
  BUILD_PROFILE_CREATED: 'buildProfileCreated',
  GET_BUILD_PROFILES: 'getBuildProfiles',
  UPDATE_BUILD_PROFILES: 'updateBuildProfiles',
  UPDATE_BUILD_PROFILE_LIBRARIES: 'updateBuildProfileLibraries',
  UPDATE_BUILD_PROFILE_PLATFORMS: 'updateBuildProfilePlatforms',
  UPDATE_BUILD_PROFILE_NOTES: 'updateBuildProfileNotes',
  UPDATE_BUILD_PROFILE_FQBN: 'updateBuildProfileFQBN',
  UPDATE_BUILD_PROFILE_PROGRAMMER: 'updateBuildProfileProgrammer',
  UPDATE_BUILD_PROFILE_PORT_SETTINGS: 'updateBuildProfilePortSettings',
  UPDATE_BUILD_PROFILE_DUPLICATE: 'updateBuildProfileDuplicate',
  RENAME_BUILD_PROFILE_NAME: 'renameBuildProfileName',
  DELETE_BUILD_PROFILE: 'deleteBuildProfile',
  SET_DEFAULT_PROFILE: 'setDefaultProfile',
  SET_COMPILE_PROFILE: 'setCompileProfile',

  // Feedback related commands
  CORE_VERSION_INSTALLED: 'coreVersionInstalled',
  CORE_UNINSTALLED: 'coreUninstalled',
  LIBRARY_VERSION_INSTALLED: 'libraryVersionInstalled',
  LIBRARY_UNINSTALLED: 'libraryVersionInstalled',
  REQUEST_BOARD_CONNECTED: "requestBoardConnected",
  INSTALL_ZIP_LIBRARY: "installZipLibrary",
  COMPILE_IN_PROGRESS: 'compileInProgress',

  // Misc commands
  OPEN_LIBRARY: 'openExample',
  CHANGE_THEME_COLOR: "changeThemeColor",
  LOG_DEBUG: "logDebug"
};
