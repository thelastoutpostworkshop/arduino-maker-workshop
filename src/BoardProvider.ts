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
        return platformNames.map(
            (platformName) =>
                new BoardItem(platformName, vscode.TreeItemCollapsibleState.Collapsed, 'platform')
        );
    }

    private getBoardsUnderPlatform(platformName: string): BoardItem[] {
        const boards = this.boardStructure[platformName] || [];
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
    private getBoards(): BoardItem[] {
        // Replace with actual logic to retrieve boards
        if (!loadArduinoConfiguration()) {
            return [];
        }
        return [
            new BoardItem('Arduino Uno', vscode.TreeItemCollapsibleState.Collapsed, 'board'),
            new BoardItem('Arduino Mega', vscode.TreeItemCollapsibleState.Collapsed, 'board'),
            new BoardItem('ESP32', vscode.TreeItemCollapsibleState.Collapsed, 'board')
        ];
    }

    private getBoardChildren(element: BoardItem): BoardItem[] {
        // Replace with actual logic to retrieve children based on the board
        if (element.label === 'Arduino Uno') {
            return [
                new BoardItem('Option A', vscode.TreeItemCollapsibleState.None, 'option'),
                new BoardItem('Option B', vscode.TreeItemCollapsibleState.None, 'option')
            ];
        }
        if (element.label === 'Arduino Mega') {
            return [
                new BoardItem('Option C', vscode.TreeItemCollapsibleState.None, 'option'),
                new BoardItem('Option D', vscode.TreeItemCollapsibleState.None, 'option')
            ];
        }
        if (element.label === 'ESP32') {
            return [
                new BoardItem('Option E', vscode.TreeItemCollapsibleState.None, 'option'),
                new BoardItem('Option F', vscode.TreeItemCollapsibleState.None, 'option')
            ];
        }
        return [];
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
