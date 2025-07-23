const path = require('path');
const fs = require('fs');
import * as yaml from 'yaml';

interface BuildProfile {
  fqbn: string;
  port?: string;
  platforms?: string[];
  libraries?: string[];
  buildProperties?: Record<string, string>;
}

interface SketchYaml {
  sketch: string;
  profiles: Record<string, BuildProfile>;
}

export class SketchProfileManager {
  static readonly FILENAME = 'sketch.yaml';

  constructor(private sketchFolder: string) {}

  exists(): boolean {
    const file = path.join(this.sketchFolder, SketchProfileManager.FILENAME);
    return fs.existsSync(file);
  }

  read(): SketchYaml | undefined {
    const file = path.join(this.sketchFolder, SketchProfileManager.FILENAME);
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
    const file = path.join(this.sketchFolder, SketchProfileManager.FILENAME);
    const content = yaml.stringify(yamlData);
    fs.writeFileSync(file, content, 'utf8');
  }

  createFromArduinoJson(arduinoJson: any, sketchFilename: string): void {
    const yamlData: SketchYaml = {
      sketch: sketchFilename,
      profiles: {
        default: {
          fqbn: arduinoJson.fqbn,
          port: arduinoJson.port,
          platforms: arduinoJson.fqbn
            ? [`${arduinoJson.fqbn.split(':')[0]}:${arduinoJson.fqbn.split(':')[1]}`]
            : undefined,
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
}
