import * as vscode from 'vscode';
import { arduinoProject, executeArduinoCommand, loadArduinoConfiguration } from './extension';
import { cliCommandArduino } from './ArduinoProject';
import { isErrored } from 'stream';

export class ComPortProvider implements vscode.TreeDataProvider<ComPortItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ComPortItem | undefined | null | void> = new vscode.EventEmitter<ComPortItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ComPortItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private selectedPort: string | undefined;

    constructor() { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ComPortItem): vscode.TreeItem {
        // Update the icon based on whether this is the selected port
        if (element.portPath === this.selectedPort) {
          element.iconPath = new vscode.ThemeIcon('check');
        } else {
          element.iconPath = undefined;
        }
        return element;
      }

    public setSelectedPort(port: string) {
        const previousPort = this.selectedPort;
        this.selectedPort = port;

        // Notify that the previous and new selected items have changed
        if (previousPort) {
            this._onDidChangeTreeData.fire(this.createComPortItem(previousPort));
        }
        this._onDidChangeTreeData.fire(this.createComPortItem(port));
    }

    // Helper method to create a ComPortItem
    private createComPortItem(portPath: string): ComPortItem {
        return new ComPortItem(portPath, portPath, vscode.TreeItemCollapsibleState.None);
    }

    async getChildren(element?: ComPortItem): Promise<ComPortItem[]> {
        if (element) {
            // No child elements
            return [];
        } else {
            // Root elements: list COM ports
            if (!loadArduinoConfiguration()) {
                return [];
            }
            const portListCommand = arduinoProject.getPortListArguments();
            try {
                const result = await executeArduinoCommand(`${cliCommandArduino}`, portListCommand, true, false);
                if (result) {
                    const ports = JSON.parse(result).detected_ports;

                    if (ports.length === 0) {
                        vscode.window.showInformationMessage('No ports detected.');
                        return [];
                    }

                    return ports.map(port => {
                        const label = port.port.label;
                        return new ComPortItem(label, port.path, vscode.TreeItemCollapsibleState.None);
                    });
                } else {
                    vscode.window.showErrorMessage('Failed to retrieve port list.');
                    return [];
                }

            } catch (error) {
                vscode.window.showErrorMessage(`Error retrieving port list: ${error}`);
                return [];
            }

        }
    }
}

class ComPortItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly portPath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);

        this.contextValue = 'comPortItem';
        // Assign a command to the tree item to handle selection
        this.command = {
            command: 'comPortExplorer.selectPort',
            title: 'Select COM Port',
            arguments: [this]
        };
    }
}
