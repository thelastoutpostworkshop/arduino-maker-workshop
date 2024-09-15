// BoardProvider.ts
import { loadArduinoConfiguration } from './extension';
import { arduinoProject,executeArduinoCommand } from './extension';
import * as vscode from 'vscode';
import { cliCommandArduino } from './ArduinoProject';

export class BoardProvider implements vscode.TreeDataProvider<BoardItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BoardItem | undefined | void> =
        new vscode.EventEmitter<BoardItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<BoardItem | undefined | void> =
        this._onDidChangeTreeData.event;

    private boardStructure: { [platform: string]: { name: string; fqbn: string }[] } = {};
    private dataFetched: boolean = false;

    constructor() { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BoardItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BoardItem): Promise<BoardItem[]> {
        if (!this.dataFetched) {
            await this.fetchBoardData();
            this.dataFetched = true;
        }

        if (element) {
            if (element.contextValue === 'platform') {
                // Return boards under the platform
                return this.getBoardsUnderPlatform(element.label);
            } else if (element.contextValue === 'board') {
                // No further children
                return [];
            } else {
                return [];
            }
        } else {
            // Return root elements (platforms)
            return this.getPlatforms();
        }
    }

    private async fetchBoardData(): Promise<void> {
        if (!loadArduinoConfiguration()) {
            return;
        }

        try {
            const listBoardArgs = arduinoProject.getBoardsListArguments();
            
            const result = await executeArduinoCommand(`${cliCommandArduino}`, listBoardArgs, true);
            const boardList = JSON.parse(result).boards;
            const boardStructure: { [platform: string]: { name: string; fqbn: string }[] } = {};
            const uniqueFqbnSet = new Set<string>();

            boardList.forEach((board: any) => {
                const platformName = board.platform.release.name;

                if (!boardStructure[platformName]) {
                    boardStructure[platformName] = [];
                }

                board.platform.release.boards.forEach((boardInfo: any) => {
                    const { name, fqbn } = boardInfo;

                    if (!uniqueFqbnSet.has(fqbn)) {
                        uniqueFqbnSet.add(fqbn);
                        boardStructure[platformName].push({ name, fqbn });
                    }
                });
            });
            this.boardStructure = boardStructure;
        } catch (error) {
            vscode.window.showErrorMessage(`Error fetching board data: ${error}`);
        }
    }

    private getPlatforms(): BoardItem[] {
        const platformNames = Object.keys(this.boardStructure);
      
        // Sort platform names alphabetically
        platformNames.sort((a, b) => a.localeCompare(b));
      
        return platformNames.map(
          (platformName) =>
            new BoardItem(platformName, vscode.TreeItemCollapsibleState.Collapsed, 'platform')
        );
      }
      

      private getBoardsUnderPlatform(platformName: string): BoardItem[] {
        const boards = this.boardStructure[platformName] || [];
      
        // Sort boards alphabetically by name
        boards.sort((a, b) => a.name.localeCompare(b.name));
      
        return boards.map(
          (boardInfo) =>
            new BoardItem(
              boardInfo.name,
              vscode.TreeItemCollapsibleState.None,
              'board',
              boardInfo.fqbn
            )
        );
      }
}

export class BoardItem extends vscode.TreeItem {
    constructor(
      public readonly label: string,
      public collapsibleState: vscode.TreeItemCollapsibleState,
      public contextValue: string,
      public fqbn?: string
    ) {
      super(label, collapsibleState);
      this.contextValue = contextValue;
  
      if (this.contextValue === 'board') {
        this.command = {
          command: 'boardSelector.selectBoard',
          title: 'Select Board',
          arguments: [this]
        };
      }
    }
  }
