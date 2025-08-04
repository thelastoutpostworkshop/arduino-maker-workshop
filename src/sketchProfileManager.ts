const path = require('path');
const fs = require('fs');
import * as yaml from 'yaml';
import { arduinoProject } from './extension';
import { BUILD_NAME_PROFILE, BuildProfile, BuildProfileUpdate, DEFAULT_PROFILE, NO_DEFAULT_PROFILE, PROFILES_STATUS, SketchYaml, UNKNOWN_PROFILE, YAML_FILENAME, YAML_FILENAME_INACTIVE } from './shared/messages';
import { window } from 'vscode';
import { DataBit, LineEnding, Parity, StopBits } from '@microsoft/vscode-serial-monitor-api';
import { sendBuildProfiles } from './VueWebviewPanel';

export class SketchProfileManager {

    private yamlInInactiveState: string = "";
    private yamlInActiveState: string = "";
    private lastError: string = "";

    constructor() {
        this.yamlInActiveState = path.join(arduinoProject.getProjectPath(), YAML_FILENAME);
        this.yamlInInactiveState = path.join(arduinoProject.getProjectPath(), YAML_FILENAME_INACTIVE);
    }
    private clearError() {
        this.lastError = "";
    }

    status(): PROFILES_STATUS {
        if (fs.existsSync(this.yamlInActiveState)) {
            return PROFILES_STATUS.ACTIVE;
        }
        if (fs.existsSync(this.yamlInInactiveState)) {
            return PROFILES_STATUS.INACTIVE;
        }
        return PROFILES_STATUS.NOT_AVAILABLE;
    }

    getLastError(): string {
        return this.lastError;
    }

    deleteProfile(profileName: string): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return false;
        }

        if (!yamlData.profiles[profileName]) {
            this.lastError = `Profile "${profileName}" not found.`;
            return false;
        }

        // Remove the profile
        delete yamlData.profiles[profileName];

        // If this profile was the default, remove the default
        if (yamlData.default_profile === profileName) {
            delete yamlData.default_profile;
        }

        // If all profiles are deleted, remove the YAML file completely
        if (Object.keys(yamlData.profiles).length === 0) {
            try {
                const status = this.status();
                if (status === PROFILES_STATUS.ACTIVE && fs.existsSync(this.yamlInActiveState)) {
                    fs.unlinkSync(this.yamlInActiveState);
                } else if (status === PROFILES_STATUS.INACTIVE && fs.existsSync(this.yamlInInactiveState)) {
                    fs.unlinkSync(this.yamlInInactiveState);
                }
                return true;
            } catch (err) {
                this.lastError = `Failed to delete last profile and YAML file: ${err}`;
                return false;
            }
        } else {
            // Save updated YAML
            this.writeYaml(yamlData);
        }

        return true;
    }

    updateProfile(profileName: string, profileData: string | BuildProfile): void {
        const yamlData = this.getYaml() ?? { profiles: {} };

        let profile: BuildProfile;
        this.clearError();

        if (typeof profileData === 'string') {
            try {
                const parsed = yaml.parse(profileData) as SketchYaml;
                const firstProfileName = Object.keys(parsed?.profiles ?? {})[0];
                profile = parsed?.profiles?.[firstProfileName];

                if (!profile || typeof profile.fqbn !== 'string') {
                    this.lastError = "Invalid or missing profile in YAML string.";
                    console.error(this.lastError);
                    return;
                }
            } catch (err) {
                this.lastError = `Failed to parse YAML string: ${err}`;
                console.error(this.lastError);
                return;
            }
        } else {
            profile = { ...profileData };
        }

        // Add programmer if in use
        if (arduinoProject.useProgrammer()) {
            profile.programmer = arduinoProject.getProgrammer() ?? profile.programmer;
        }

        // Port settings
        const monitorSettings = arduinoProject.getMonitorPortSettings();
        profile.port = monitorSettings.port ?? profile.port;
        profile.port_config = {
            baudrate: monitorSettings.baudRate?.toString() ?? "115200",
            bits: monitorSettings.dataBits?.toString() ?? "8",
            parity: monitorSettings.parity ?? "none",
            stop_bits: monitorSettings.stopBits?.toString() ?? "1",
        };

        // Save to YAML
        yamlData.profiles[profileName] = profile;
        this.writeYaml(yamlData);
    }

    getProfilePort(profileName: string): string | undefined {
        this.clearError();
        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return undefined;
        }

        const profile = yamlData.profiles[profileName];
        if (!profile) {
            this.lastError = `Profile "${profileName}" not found.`;
            return undefined;
        }

        return profile.port;
    }

    updateProfileLibraries(librariesUpdate: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return false;
        }

        const profile = yamlData.profiles[librariesUpdate.profile_name];
        if (!profile) {
            this.lastError = `Profile "${librariesUpdate.profile_name}" not found.`;
            return false;
        }

        // Update libraries
        if (librariesUpdate.libraries) {
            profile.libraries = [...librariesUpdate.libraries];

            // Save the updated YAML
            yamlData.profiles[librariesUpdate.profile_name] = profile;
            this.writeYaml(yamlData);
            return true;
        } else {
            this.lastError = "No libaries update found";
            return false;
        }

    }

    updateProfilePlatforms(platformsUpdate: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return false;
        }

        const profile = yamlData.profiles[platformsUpdate.profile_name];
        if (!profile) {
            this.lastError = `Profile "${platformsUpdate.profile_name}" not found.`;
            return false;
        }

        // Update platforms
        if (platformsUpdate.platforms) {
            profile.platforms = [...platformsUpdate.platforms];

            // Save the updated YAML
            yamlData.profiles[platformsUpdate.profile_name] = profile;
            this.writeYaml(yamlData);

            return true;
        } else {
            this.lastError = "No platforms update found";
            return false;
        }
    }

    getProfileMonitorPortSettings(profileName: string): {
        port: string;
        baudRate: number;
        lineEnding: LineEnding;
        dataBits: DataBit;
        parity: Parity;
        stopBits: StopBits;
    } | undefined {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return undefined;
        }

        const profile = yamlData.profiles[profileName];
        if (!profile) {
            this.lastError = `Profile "${profileName}" not found.`;
            return undefined;
        }

        if (!profile.port) {
            this.lastError = `Profile "${profileName}" does not define a port.`;
            return undefined;
        }

        // Convert port_config safely
        const portConfig = profile.port_config ?? {};

        // Map YAML string values to enum values
        const stopBits: StopBits = ((): StopBits => {
            switch (portConfig.stop_bits) {
                case "1.5": return StopBits.Onepointfive;
                case "2": return StopBits.Two;
                default: return StopBits.One;
            }
        })();

        const parity: Parity = ((): Parity => {
            switch (portConfig.parity) {
                case "odd": return Parity.Odd;
                case "even": return Parity.Even;
                case "mark": return Parity.Mark;
                case "space": return Parity.Space;
                default: return Parity.None;
            }
        })();

        const lineEnding: LineEnding = ((): LineEnding => {
            switch (portConfig.lineEnding) {
                case "\r": return LineEnding.CR;
                case "\n": return LineEnding.LF;
                case "none": return LineEnding.None;
                default: return LineEnding.CRLF;
            }
        })();

        const dataBits: DataBit = (parseInt(portConfig.bits ?? "8") as DataBit);

        return {
            port: profile.port,
            baudRate: parseInt(portConfig.baudrate ?? "115200"),
            lineEnding,
            dataBits,
            parity,
            stopBits,
        };
    }

    private getBoardNameFromFqbn(fqbn: string): string | undefined {
        if (!fqbn || typeof fqbn !== "string") return undefined;

        const lastColonIndex = fqbn.lastIndexOf(":");
        if (lastColonIndex === -1) {
            // No colon found, return the whole string
            return fqbn;
        }

        // Return everything before the last colon
        return fqbn.substring(0, lastColonIndex);
    }


    updateProfileFqbn(updateFqbn: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return false;
        }

        const profile = yamlData.profiles[updateFqbn.profile_name];
        if (!profile) {
            this.lastError = `Profile "${updateFqbn.profile_name}" not found.`;
            return false;
        }

        if (updateFqbn.fqbn) {
            const board_name = this.getBoardNameFromFqbn(profile.fqbn);
            profile.fqbn = board_name + ":" + updateFqbn.fqbn;
            yamlData.profiles[updateFqbn.profile_name] = profile;

            this.writeYaml(yamlData);
            return true;
        } else {
            this.lastError = "No fqbn provided";
            return false;
        }
    }

    getYaml(): SketchYaml | undefined {
        let file: string = "";

        this.clearError();
        switch (this.status()) {
            case PROFILES_STATUS.ACTIVE:
                file = this.yamlInActiveState;
                break;
            case PROFILES_STATUS.INACTIVE:
                file = this.yamlInInactiveState
                break;
            default:
                break;
        }
        if (file.length > 0) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const data = yaml.parse(content) as SketchYaml;
                if (!this.verify(data) && this.status() == PROFILES_STATUS.ACTIVE) {
                    this.setProfileStatus(PROFILES_STATUS.INACTIVE); // Set inactive if the yaml is malformed.
                    window.showErrorMessage(`The ${YAML_FILENAME} has errors and is now inactive`);
                    return undefined;
                }
                return data;
            } catch (error) {
                if (this.status() == PROFILES_STATUS.ACTIVE) {
                    this.setProfileStatus(PROFILES_STATUS.INACTIVE); // Set inactive if any error reading the yaml file.
                    window.showErrorMessage(`The ${YAML_FILENAME} has errors and is now inactive`);
                }
                this.lastError = `Failed to read build profile: ${error}`;
                console.error(this.lastError);
                return undefined;
            }
        }
    }
    setProfileStatus(newStatus: PROFILES_STATUS) {
        const currentStatus = this.status();

        if (currentStatus === PROFILES_STATUS.NOT_AVAILABLE) {
            return;
        }

        // Move from inactive → active
        if (newStatus === PROFILES_STATUS.ACTIVE) {
            fs.renameSync(this.yamlInInactiveState, this.yamlInActiveState);
            return;
        }

        // Move from active → inactive
        if (newStatus === PROFILES_STATUS.INACTIVE) {
            // this.verifyInactiveFolder();
            fs.renameSync(this.yamlInActiveState, this.yamlInInactiveState);
            return;
        }
    }

    writeYaml(yamlData: SketchYaml): void {
        let file: string = "";

        switch (this.status()) {
            case PROFILES_STATUS.ACTIVE:
                file = this.yamlInActiveState;
                break;
            case PROFILES_STATUS.INACTIVE:
                file = this.yamlInInactiveState
                break;
            case PROFILES_STATUS.NOT_AVAILABLE:
                file = this.yamlInInactiveState
                break;
            default:
                break;
        }
        if (file.length > 0) {
            const content = yaml.stringify(yamlData);
            fs.writeFileSync(file, content, 'utf8');
        }
    }

    create(): void {
        const yamlData: SketchYaml = {
            profiles: {
                profile_1: {
                    fqbn: arduinoProject.getBoardConfiguration(),
                    platforms: [
                        {
                            platform: arduinoProject.getBoard()
                        }
                    ]
                },
            },
        };

        this.writeYaml(yamlData);
    }

    listProfiles(): string[] {
        const yamlData = this.getYaml();
        return yamlData ? Object.keys(yamlData.profiles) : [];
    }

    getProfile(name: string): BuildProfile | undefined {
        const yamlData = this.getYaml();
        return yamlData?.profiles[name];
    }

    setDefaultProfile(profileName: string): void {
        const yamlData = this.getYaml();
        this.clearError();

        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No build profiles available.";
            return;
        }

        // Special case: remove default profile if "not" is passed
        if (profileName === NO_DEFAULT_PROFILE) {
            delete yamlData.default_profile;
            this.writeYaml(yamlData);
            return;
        }

        if (!yamlData.profiles[profileName]) {
            this.lastError = `Profile "${profileName}" not found.`;
            return;
        }

        // Set default profile explicitly
        yamlData.default_profile = profileName;

        // Optional: Reorder profiles with selected profile first
        const reordered: Record<string, BuildProfile> = {
            [profileName]: yamlData.profiles[profileName],
        };

        for (const [key, value] of Object.entries(yamlData.profiles)) {
            if (key !== profileName) {
                reordered[key] = value;
            }
        }

        yamlData.profiles = reordered;
        this.writeYaml(yamlData);
    }
    getProfileName(): string {
        let buildforProfile;
        const profileSelected = arduinoProject.getCompileProfile();
        if (profileSelected === DEFAULT_PROFILE) {
            buildforProfile = this.getDefaultProfileName();
            if (!buildforProfile) {
                return UNKNOWN_PROFILE;
            }
            return buildforProfile
        } else {
            buildforProfile = profileSelected;
            return buildforProfile;
        }
    }
    getBuildFolderProfileName(): string {
        return BUILD_NAME_PROFILE + this.getProfileName();
    }
    getDefaultProfileName(): string | undefined {
        this.clearError();
        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return undefined;
        }

        const defaultProfile = yamlData.default_profile;
        if (defaultProfile && yamlData.profiles[defaultProfile]) {
            return defaultProfile;
        }

        return undefined;
    }

    renameProfile(newProfileName: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return false;
        }

        // Check if old profile exists
        if (!yamlData.profiles[newProfileName.profile_name]) {
            this.lastError = `Profile "${newProfileName.profile_name}" not found.`;
            return false;
        }

        // Ensure new name is provided
        if (!newProfileName.new_profile_name) {
            this.lastError = "New name not provided.";
            return false;
        }

        // Ensure new name doesn't exist
        if (yamlData.profiles[newProfileName.new_profile_name]) {
            this.lastError = `Profile "${newProfileName.new_profile_name}" already exists.`;
            window.showErrorMessage(this.lastError);
            sendBuildProfiles();
            return false;
        }

        // Rename the profile
        yamlData.profiles[newProfileName.new_profile_name] = yamlData.profiles[newProfileName.profile_name];
        delete yamlData.profiles[newProfileName.profile_name];

        // Update default_profile if necessary
        if (yamlData.default_profile === newProfileName.profile_name) {
            yamlData.default_profile = newProfileName.new_profile_name;
        }

        this.writeYaml(yamlData);
        return true;
    }


    updateProfileNotes(updateNotes: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.lastError = "No YAML data or profiles found.";
            return false;
        }

        const profile = yamlData.profiles[updateNotes.profile_name];
        if (!profile) {
            this.lastError = `Profile "${updateNotes.profile_name}" not found.`;
            return false;
        }

        if (updateNotes.notes) {
            profile.notes = updateNotes.notes;
            yamlData.profiles[updateNotes.profile_name] = profile;

            this.writeYaml(yamlData);
            return true;
        } else {
            this.lastError = 'No notes provided'
            return false;
        }
    }

    verify(yaml: SketchYaml): boolean {
        this.clearError();

        if (this.status() === PROFILES_STATUS.ACTIVE || this.status() === PROFILES_STATUS.INACTIVE) {
            if (!yaml.profiles || typeof yaml.profiles !== 'object') {
                this.lastError = `Missing or invalid "profiles" section.`;
                return false;
            }

            const profileKeys = Object.keys(yaml.profiles);
            if (profileKeys.length === 0) {
                this.lastError = `No profiles defined in "profiles" section.`;
                return false;
            }

            for (const [name, profile] of Object.entries(yaml.profiles)) {
                // Validate fqbn
                if (!profile.fqbn || typeof profile.fqbn !== 'string') {
                    this.lastError = `Profile "${name}" is missing a valid "fqbn".`;
                    return false;
                }

                // Validate port if present
                if (profile.port && typeof profile.port !== 'string') {
                    this.lastError = `Profile "${name}" has an invalid "port" (must be a string).`;
                    return false;
                }

                // Validate port_config if present
                if (profile.port_config) {
                    if (typeof profile.port_config !== 'object' || Array.isArray(profile.port_config)) {
                        this.lastError = `Profile "${name}" has an invalid "port_config" (must be an object/map).`;
                        return false;
                    }

                    for (const [key, value] of Object.entries(profile.port_config)) {
                        if (typeof key !== 'string' || typeof value !== 'string') {
                            this.lastError = `Profile "${name}" has invalid entries in "port_config" (keys and values must be strings).`;
                            return false;
                        }
                    }
                }
            }
        }

        return true;
    }

}