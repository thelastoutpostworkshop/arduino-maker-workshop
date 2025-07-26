const path = require('path');
const fs = require('fs');
import * as yaml from 'yaml';
import { arduinoProject } from './extension';
import { BuildProfile, PROFILES_STATUS, SketchYaml, YAML_FILENAME } from './shared/messages';
import { VSCODE_FOLDER } from './ArduinoProject';

export class SketchProfileManager {

    private yamlInVscodeFolder: string = "";
    private yamlInSketchFolder: string = "";

    constructor(private sketchFolder: string) {
        this.yamlInVscodeFolder = path.join(arduinoProject.getProjectPath(), VSCODE_FOLDER, YAML_FILENAME);
        this.yamlInSketchFolder = path.join(this.sketchFolder, YAML_FILENAME);
    }

    status(): PROFILES_STATUS {
        if (fs.existsSync(this.yamlInSketchFolder)) {
            return PROFILES_STATUS.ACTIVE;
        }
        if (fs.existsSync(this.yamlInVscodeFolder)) {
            return PROFILES_STATUS.INACTIVE;
        }
        return PROFILES_STATUS.NOT_AVAILABLE;
    }

    read(): SketchYaml | undefined {
        let file: string = "";

        switch (this.status()) {
            case PROFILES_STATUS.ACTIVE:
                file = this.yamlInSketchFolder;
                break;
            case PROFILES_STATUS.INACTIVE:
                file = this.yamlInVscodeFolder
                break;
            default:
                break;
        }
        if (file.length > 0) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const data = yaml.parse(content) as SketchYaml;
                return data;
            } catch (error) {
                console.error('Failed to read build profile:', error);
                return undefined;
            }
        }
    }
    toggleProfileAvailability(): PROFILES_STATUS {
        switch (this.status()) {
            case PROFILES_STATUS.ACTIVE:
                fs.renameSync(this.yamlInSketchFolder, this.yamlInVscodeFolder);
                return PROFILES_STATUS.INACTIVE;
                break;
            case PROFILES_STATUS.INACTIVE:
                fs.renameSync(this.yamlInVscodeFolder, this.yamlInSketchFolder);
                return PROFILES_STATUS.ACTIVE;
                break;
            default:
                return PROFILES_STATUS.NOT_AVAILABLE;
                break;
        }
    }
    write(yamlData: SketchYaml): void {
        const file = path.join(this.sketchFolder, YAML_FILENAME);
        const content = yaml.stringify(yamlData);
        fs.writeFileSync(file, content, 'utf8');
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

        this.write(yamlData);
    }

    listProfiles(): string[] {
        const yamlData = this.read();
        return yamlData ? Object.keys(yamlData.profiles) : [];
    }

    getProfile(name: string): BuildProfile | undefined {
        const yamlData = this.read();
        return yamlData?.profiles[name];
    }

    verify(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (this.status() == PROFILES_STATUS.ACTIVE || this.status() == PROFILES_STATUS.INACTIVE) {
            const data = this.read();
            if (!data) {
                return { valid: false, errors: ['Unable to read sketch.yaml'] };
            }

            if (!data.profiles || typeof data.profiles !== 'object') {
                errors.push('Missing or invalid "profiles" section.');
            } else {
                const profileKeys = Object.keys(data.profiles);
                if (profileKeys.length === 0) {
                    errors.push('No profiles defined in "profiles" section.');
                } else {
                    for (const [name, profile] of Object.entries(data.profiles)) {
                        if (!profile.fqbn || typeof profile.fqbn !== 'string') {
                            errors.push(`Profile "${name}" is missing a valid "fqbn".`);
                        }
                    }
                }
            }
        } else {
            return { valid: true, errors: ['Create a sketch.yaml first'] };
        }

        return { valid: errors.length === 0, errors };
    }
}
