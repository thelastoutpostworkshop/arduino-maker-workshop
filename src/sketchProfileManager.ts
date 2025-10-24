const path = require('path');
const fs = require('fs');
import * as yaml from 'yaml';
import { arduinoCLI, arduinoExtensionChannel, arduinoProject } from './extension';
import { BUILD_NAME_PROFILE, BuildProfile, BuildProfileUpdate, DEFAULT_PROFILE, NO_DEFAULT_PROFILE, PROFILES_STATUS, SketchYaml, UNKNOWN_PROFILE, YAML_FILENAME, YAML_FILENAME_INACTIVE } from './shared/messages';
import { window } from 'vscode';
import { DataBit, LineEnding, Parity, StopBits } from '@microsoft/vscode-serial-monitor-api';
import { sendBuildProfiles } from './VueWebviewPanel';

export class SketchProfileManager {

    private yamlInInactiveState: string = "";
    private yamlInActiveState: string = "";
    private lastError: string = "";
    private lastActiveProfileName: string | undefined;
    private lastActiveProfileFingerprint: string | undefined;
    private hasActiveProfileBaseline: boolean = false;

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

    private setLastError(error: string) {
        this.lastError = error;
        arduinoExtensionChannel.appendLine(error);
    }

    deleteProfile(profileName: string): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot delete profile ${profileName} no YAML data or profiles found.`);
            return false;
        }

        if (!yamlData.profiles[profileName]) {
            this.setLastError(`Cannot delete profile, "${profileName}" not found.`);
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
                this.setLastError(`Failed to delete last profile and YAML file: ${err}`);
                return false;
            }
        } else {
            // Save updated YAML
            this.writeYaml(yamlData);
        }

        return true;
    }

    createProfile(profileName: string, profileData: string | BuildProfile): void {
        const yamlData = this.getYaml() ?? { profiles: {} };

        let profile: BuildProfile;
        this.clearError();

        if (typeof profileData === 'string') {
            try {
                const parsed = yaml.parse(profileData) as SketchYaml;
                const firstProfileName = Object.keys(parsed?.profiles ?? {})[0];
                profile = parsed?.profiles?.[firstProfileName];

                if (!profile || typeof profile.fqbn !== 'string') {
                    this.setLastError(`Cannot update ${profileName}, Invalid or missing profile in YAML string.`);
                    return;
                }
            } catch (err) {
                this.setLastError(`Cannot update ${profileName}, failed to parse YAML string: ${err}`);
                return;
            }
        } else {
            profile = { ...profileData };
        }

        // Add programmer 
        if (arduinoProject.useProgrammer()) {
            profile.programmer = arduinoProject.getProgrammer() ?? "";
        } else {
            profile.programmer = "";
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
            this.setLastError(`Cannot get port of profile ${profileName}, no YAML data or profiles found.`);
            return undefined;
        }

        const profile = yamlData.profiles[profileName];
        if (!profile) {
            this.setLastError(`Cannot get port, profile "${profileName}" not found.`);
            return undefined;
        }

        return profile.port;
    }

    updateProfileLibraries(librariesUpdate: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot update libraries, no YAML data or profiles found`);
            return false;
        }

        const profile = yamlData.profiles[librariesUpdate.profile_name];
        if (!profile) {
            this.setLastError(`Cannot update libraries, profile "${librariesUpdate.profile_name}" not found.`);
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
            this.setLastError(`No libaries update found`);
            return false;
        }

    }

    updateProfilePlatforms(platformsUpdate: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot update platforms, no YAML data or profiles found`);
            return false;
        }

        const profile = yamlData.profiles[platformsUpdate.profile_name];
        if (!profile) {
            this.setLastError(`Cannot update platforms, profile "${platformsUpdate.profile_name}" not found.`);
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
            this.setLastError(`No platforms update found`);
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
            this.setLastError(`Cannot get monitor port settings, no YAML data or profiles found`);
            return undefined;
        }

        const profile = yamlData.profiles[profileName];
        if (!profile) {
            this.setLastError(`Cannot get monitor port settings, profile "${profileName}" not found.`);
            return undefined;
        }

        if (!profile.port) {
            this.setLastError(`Cannot get monitor port settings, profile "${profileName}" does not define a port.`);
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

    updateProfilePortSettings(portSettings: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot update port settings, no YAML data or profiles found.`);
            return false;
        }

        const profile = yamlData.profiles[portSettings.profile_name];
        if (!profile) {
            this.setLastError(`Cannot update port settings, profile "${portSettings.profile_name}" not found.`);
            return false;
        }

        if (portSettings.port_settings) {
            // Update port and port_config
            profile.port = portSettings.port_settings.port;
            profile.port_config = {
                baudrate: portSettings.port_settings.baudRate.toString(),
                lineEnding: portSettings.port_settings.lineEnding,
                bits: portSettings.port_settings.dataBits.toString(),
                parity: portSettings.port_settings.parity,
                stop_bits: portSettings.port_settings.stopBits
            };

            // Save updated profile
            yamlData.profiles[portSettings.profile_name] = profile;
            this.writeYaml(yamlData);
            return true;
        } else {
            this.setLastError(`No port settinfs value provided`);
            return false;
        }

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

    updateProfileProgrammer(programmerUpdate: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot update programmer, no YAML data or profiles found`);
            return false;
        }

        const profile = yamlData.profiles[programmerUpdate.profile_name];
        if (!profile) {
            this.setLastError(`Cannot update programmer, profile "${programmerUpdate.profile_name}" not found.`);
            return false;
        }

        // Update programmer
        if (programmerUpdate.programmer !== undefined) {
            profile.programmer = programmerUpdate.programmer;
            yamlData.profiles[programmerUpdate.profile_name] = profile;

            // Save the updated YAML
            this.writeYaml(yamlData);
            return true;
        } else {
            this.setLastError(`No programmer value provided`);
            return false;
        }
    }

    updateProfileFqbn(updateFqbn: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot update profile FQBN, no YAML data or profiles found`);
            return false;
        }

        const profile = yamlData.profiles[updateFqbn.profile_name];
        if (!profile) {
            this.setLastError(`Cannot update profile FQBN, profile "${updateFqbn.profile_name}" not found.`);
            return false;
        }

        if (updateFqbn.fqbn) {
            const board_name = this.getBoardNameFromFqbn(profile.fqbn);
            profile.fqbn = board_name + ":" + updateFqbn.fqbn;
            yamlData.profiles[updateFqbn.profile_name] = profile;

            this.writeYaml(yamlData);
            return true;
        } else {
            this.setLastError("Cannot update profile FQBN, no fqbn provided");
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
            const fileIsActive = file === this.yamlInActiveState;
            try {
                const content = fs.readFileSync(file, 'utf8');
                const data = yaml.parse(content) as SketchYaml;
                if (!this.verify(data) && this.status() == PROFILES_STATUS.ACTIVE) {
                    this.setProfileStatus(PROFILES_STATUS.INACTIVE); // Set inactive if the yaml is malformed.
                    window.showErrorMessage(`The ${YAML_FILENAME} has errors and is now inactive`);
                    this.resetActiveProfileCache();
                    return undefined;
                }
                this.updateActiveProfileCache(data, fileIsActive);
                return data;
            } catch (error) {
                if (this.status() == PROFILES_STATUS.ACTIVE) {
                    this.setProfileStatus(PROFILES_STATUS.INACTIVE); // Set inactive if any error reading the yaml file.
                    window.showErrorMessage(`The ${YAML_FILENAME} has errors and is now inactive`);
                }
                this.resetActiveProfileCache();
                this.setLastError(`Failed to read build profile: ${error}`);
                return undefined;
            }
        }
        this.resetActiveProfileCache();
    }
    setProfileStatus(newStatus: PROFILES_STATUS) {
        const currentStatus = this.status();

        if (currentStatus === PROFILES_STATUS.NOT_AVAILABLE) {
            return;
        }

        if (currentStatus === newStatus) {
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
            let previousData: SketchYaml | undefined;
            if (fs.existsSync(file)) {
                try {
                    const previousContent = fs.readFileSync(file, 'utf8');
                    previousData = yaml.parse(previousContent) as SketchYaml;
                } catch (error) {
                    arduinoExtensionChannel.appendLine(`Failed to read previous ${YAML_FILENAME}: ${error}`);
                }
            }

            const content = yaml.stringify(yamlData);
            fs.writeFileSync(file, content, 'utf8');
            this.updateActiveProfileCache(
                yamlData,
                file === this.yamlInActiveState,
                previousData
            );
        }
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
            this.setLastError("Cannot set default profile, no build profiles available.");
            return;
        }

        // Special case: remove default profile if "not" is passed
        if (profileName === NO_DEFAULT_PROFILE) {
            delete yamlData.default_profile;
            this.writeYaml(yamlData);
            return;
        }

        if (!yamlData.profiles[profileName]) {
            this.setLastError(`Cannot set default profile, profile "${profileName}" not found.`);
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
            this.setLastError("Cannot get default profile, no build profiles available.");
            return undefined;
        }

        const defaultProfile = yamlData.default_profile;
        if (defaultProfile && yamlData.profiles[defaultProfile]) {
            return defaultProfile;
        }

        return undefined;
    }

    duplicateProfile(duplicate: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError(`Cannot duplicate "${duplicate.profile_name}", no YAML data or profiles found.`);
            return false;
        }

        const src = yamlData.profiles[duplicate.profile_name];
        if (!src) {
            this.setLastError(`Cannot duplicate, source profile "${duplicate.profile_name}" not found.`);
            return false;
        }

        const target = (duplicate.new_profile_name || "").trim();
        if (!target) {
            this.setLastError("Cannot duplicate, new profile name is empty.");
            return false;
        }

        // UI should already ensure uniqueness, but we still guard here.
        if (yamlData.profiles[target]) {
            this.setLastError(`Cannot duplicate, target profile "${target}" already exists.`);
            return false;
        }

        // Deep clone & insert
        const cloned: BuildProfile = JSON.parse(JSON.stringify(src));
        yamlData.profiles[target] = cloned;

        // Do NOT change default_profile automatically
        this.writeYaml(yamlData);

        sendBuildProfiles();

        return true;
    }

    renameProfile(newProfileName: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError("Cannot rename profile, no build profiles available.");
            return false;
        }

        const oldName = newProfileName.profile_name;
        const newName = newProfileName.new_profile_name?.trim();
        if (!oldName || !yamlData.profiles[oldName]) {
            this.setLastError(`Cannot rename profile, profile "${oldName}" not found.`);
            return false;
        }
        if (!newName) {
            this.setLastError("Cannot rename profile, new name not provided.");
            return false;
        }
        if (yamlData.profiles[newName]) {
            this.setLastError(`Cannot rename profile, profile "${newName}" already exists.`);
            sendBuildProfiles();
            return false;
        }

        // Rebuild profiles preserving order; replace key inline
        const reordered: Record<string, BuildProfile> = {};
        for (const [key, value] of Object.entries(yamlData.profiles)) {
            if (key === oldName) {
                reordered[newName] = value;     // keep position
            } else {
                reordered[key] = value;
            }
        }
        yamlData.profiles = reordered;

        // Update default_profile if necessary
        if (yamlData.default_profile === oldName) {
            yamlData.default_profile = newName;
        }

        this.writeYaml(yamlData);
        return true;
    }



    updateProfileNotes(updateNotes: BuildProfileUpdate): boolean {
        this.clearError();

        const yamlData = this.getYaml();
        if (!yamlData || !yamlData.profiles) {
            this.setLastError("Cannot update notes, no build profiles available.");
            return false;
        }

        const profile = yamlData.profiles[updateNotes.profile_name];
        if (!profile) {
            this.setLastError(`Cannot update notes, profile "${updateNotes.profile_name}" not found.`);
            return false;
        }

        if (updateNotes.notes) {
            profile.notes = updateNotes.notes;
            yamlData.profiles[updateNotes.profile_name] = profile;

            this.writeYaml(yamlData);
            return true;
        } else {
            this.setLastError('Cannot update notes, no notes provided')
            return false;
        }
    }

    private updateActiveProfileCache(
        currentData: SketchYaml | undefined,
        fileIsActive: boolean,
        previousData?: SketchYaml
    ): void {
        const selectedProfile = arduinoProject.getCompileProfile();
        const currentActiveName = this.resolveActiveProfileName(currentData, selectedProfile);
        const currentFingerprint = currentActiveName && currentData?.profiles
            ? this.profileFingerprint(currentData.profiles[currentActiveName])
            : undefined;

        let previousActiveName = this.lastActiveProfileName;
        let previousFingerprint = this.lastActiveProfileFingerprint;

        if (previousData && previousData.profiles) {
            previousActiveName = this.resolveActiveProfileName(previousData, selectedProfile);
            previousFingerprint = previousActiveName && previousData.profiles
                ? this.profileFingerprint(previousData.profiles[previousActiveName])
                : undefined;
        }

        const hasBaseline = this.hasActiveProfileBaseline;
        const hasChanged = hasBaseline && fileIsActive && (
            previousActiveName !== currentActiveName ||
            previousFingerprint !== currentFingerprint
        );

        if (hasChanged) {
            arduinoCLI?.setBuildResult(false);
        }

        this.lastActiveProfileName = currentActiveName;
        this.lastActiveProfileFingerprint = currentFingerprint;

        if (fileIsActive) {
            this.hasActiveProfileBaseline = true;
        }
    }

    private resolveActiveProfileName(data: SketchYaml | undefined, selectedProfile: string | undefined): string | undefined {
        if (!data || !data.profiles || !selectedProfile || selectedProfile.trim().length === 0) {
            return undefined;
        }

        if (selectedProfile === DEFAULT_PROFILE) {
            const defaultProfile = data.default_profile;
            if (defaultProfile && data.profiles[defaultProfile]) {
                return defaultProfile;
            }
            return undefined;
        }

        return data.profiles[selectedProfile] ? selectedProfile : undefined;
    }

    private profileFingerprint(profile: BuildProfile | undefined): string | undefined {
        if (!profile) {
            return undefined;
        }

        const libraries = profile.libraries
            ? profile.libraries.map((entry) =>
                typeof entry === 'string' ? entry : JSON.stringify(entry)
            ).sort()
            : [];

        const platforms = profile.platforms
            ? profile.platforms.map((platform) => JSON.stringify({
                platform: platform.platform ?? '',
                platform_index_url: platform.platform_index_url ?? ''
            })).sort()
            : [];

        const portConfig = profile.port_config
            ? Object.entries(profile.port_config)
                .map(([key, value]) => `${key}:${value ?? ''}`)
                .sort()
            : [];

        return JSON.stringify({
            fqbn: profile.fqbn ?? '',
            programmer: profile.programmer ?? '',
            port: profile.port ?? '',
            protocol: profile.protocol ?? '',
            notes: profile.notes ?? '',
            libraries,
            platforms,
            port_config: portConfig,
        });
    }

    private resetActiveProfileCache(): void {
        this.lastActiveProfileName = undefined;
        this.lastActiveProfileFingerprint = undefined;
        this.hasActiveProfileBaseline = false;
    }

    verify(yaml: SketchYaml): boolean {
        this.clearError();

        if (this.status() === PROFILES_STATUS.ACTIVE || this.status() === PROFILES_STATUS.INACTIVE) {
            if (!yaml.profiles || typeof yaml.profiles !== 'object') {
                this.setLastError(`YAML verification: missing or invalid "profiles" section.`);
                return false;
            }

            const profileKeys = Object.keys(yaml.profiles);
            if (profileKeys.length === 0) {
                this.setLastError(`YAML verification: No profiles defined in "profiles" section.`);
                return false;
            }

            for (const [name, profile] of Object.entries(yaml.profiles)) {
                // Validate fqbn
                if (!profile.fqbn || typeof profile.fqbn !== 'string') {
                    this.setLastError(`YAML verification: profile "${name}" is missing a valid "fqbn".`);
                    return false;
                }

                // Validate port if present
                if (profile.port && typeof profile.port !== 'string') {
                    this.setLastError(`YAML verification: profile "${name}" has an invalid "port" (must be a string).`);
                    return false;
                }

                // Validate port_config if present
                if (profile.port_config) {
                    if (typeof profile.port_config !== 'object' || Array.isArray(profile.port_config)) {
                        this.setLastError(`YAML verification: profile "${name}" has an invalid "port_config" (must be an object/map).`);
                        return false;
                    }

                    for (const [key, value] of Object.entries(profile.port_config)) {
                        if (typeof key !== 'string' || typeof value !== 'string') {
                            this.setLastError(`YAML verification: profile "${name}" has invalid entries in "port_config" (keys and values must be strings).`);
                            return false;
                        }
                    }
                }
            }
        }

        return true;
    }

}
