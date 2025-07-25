const path = require('path');
const fs = require('fs');
import * as yaml from 'yaml';
import { arduinoProject } from './extension';
import { BuildProfile, SketchYaml, YAML_FILENAME } from './shared/messages';

export class SketchProfileManager {

    constructor(private sketchFolder: string) { }

    exists(): boolean {
        const file = path.join(this.sketchFolder, YAML_FILENAME);
        return fs.existsSync(file);
    }

    read(): SketchYaml | undefined {
        const file = path.join(this.sketchFolder, YAML_FILENAME);
        try {
            const content = fs.readFileSync(file, 'utf8');
            const data = yaml.parse(content) as SketchYaml;
            return data;
        } catch (error) {
            console.error('Failed to read build profile:', error);
            return undefined;
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

        if (this.exists()) {
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
