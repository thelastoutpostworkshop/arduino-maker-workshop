const path = require('path');
const fs = require('fs');
import * as yaml from 'yaml';
import { arduinoExtensionChannel, arduinoProject } from './extension';
import { BuildProfile, PROFILES_STATUS, SketchYaml, YAML_FILENAME } from './shared/messages';
import { VSCODE_FOLDER } from './ArduinoProject';
import { workspace } from 'vscode';

export class SketchProfileManager {

    private yamlInInactiveState: string = "";
    private yamlInActiveState: string = "";
    private lastError: string = "";

    constructor() {
        const config = workspace.getConfiguration('arduinoMakerWorkshop');
        const inactiveFolder = config.get<string>('buildProfilesInactiveFolder', "Build Profiles Inactive");
        arduinoExtensionChannel.appendLine(`Build profiles inactive folder is '${inactiveFolder}'`);

        this.yamlInInactiveState = path.join(arduinoProject.getProjectPath(), inactiveFolder, YAML_FILENAME);
        this.yamlInActiveState = path.join(arduinoProject.getProjectPath(), YAML_FILENAME);
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

    updateProfile(profileName: string, profileData: string | BuildProfile): void {
        const yamlData = this.getYaml() ?? { profiles: {} };

        let profile: BuildProfile;
        this.lastError = "";
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
            profile = profileData;
        }

        yamlData.profiles[profileName] = profile;
        this.writeYaml(yamlData);
    }


    getYaml(): SketchYaml | undefined {
        let file: string = "";

        this.lastError = "";
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
                if (!this.verify(data)) {
                    return undefined;
                }
                return data;
            } catch (error) {
                this.lastError = `Failed to read build profile: ${error}`;
                console.error(this.lastError);
                return undefined;
            }
        }
    }
    setProfileStatus(newStatus: PROFILES_STATUS) {
        const currentStatus = this.status();
        if (newStatus == PROFILES_STATUS.ACTIVE && currentStatus == PROFILES_STATUS.INACTIVE) {
            fs.renameSync(this.yamlInInactiveState, this.yamlInActiveState);
            return;
        }
        if (newStatus == PROFILES_STATUS.INACTIVE && currentStatus == PROFILES_STATUS.ACTIVE) {
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

    verify(yaml: SketchYaml): boolean {
        if (this.status() == PROFILES_STATUS.ACTIVE || this.status() == PROFILES_STATUS.INACTIVE) {
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
                if (!profile.fqbn || typeof profile.fqbn !== 'string') {
                    this.lastError = `Profile "${name}" is missing a valid "fqbn".`;
                    return false;
                }
            }
        }
        return true;
    }
}