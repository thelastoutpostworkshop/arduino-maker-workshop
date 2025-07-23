import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { Uri } from 'vscode';

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
  static readonly FILENAME = 'arduino.sketch.yaml';

  constructor(private sketchFolder: Uri) {}

  async exists(): Promise<boolean> {
    const file = path.join(this.sketchFolder.fsPath, SketchProfileManager.FILENAME);
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  async read(): Promise<SketchYaml | undefined> {
    const file = path.join(this.sketchFolder.fsPath, SketchProfileManager.FILENAME);
    try {
      const content = await fs.readFile(file, 'utf8');
      const data = yaml.parse(content) as SketchYaml;
      return data;
    } catch (error) {
      console.error('Failed to read build profile:', error);
      return undefined;
    }
  }

  async write(yamlData: SketchYaml): Promise<void> {
    const file = path.join(this.sketchFolder.fsPath, SketchProfileManager.FILENAME);
    const content = yaml.stringify(yamlData);
    await fs.writeFile(file, content, 'utf8');
  }

  async createFromArduinoJson(arduinoJson: any, sketchFilename: string): Promise<void> {
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

    await this.write(yamlData);
  }

  async listProfiles(): Promise<string[]> {
    const yamlData = await this.read();
    return yamlData ? Object.keys(yamlData.profiles) : [];
  }

  async getProfile(name: string): Promise<BuildProfile | undefined> {
    const yamlData = await this.read();
    return yamlData?.profiles[name];
  }
}
