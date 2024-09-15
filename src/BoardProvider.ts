// BoardProvider.ts
import { loadArduinoConfiguration } from './extension';
import { arduinoProject, executeArduinoCommand } from './extension';
import * as vscode from 'vscode';
import { cliCommandArduino } from './ArduinoProject';

export class BoardProvider implements vscode.TreeDataProvider<BoardItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BoardItem | undefined | void> =
        new vscode.EventEmitter<BoardItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<BoardItem | undefined | void> =
        this._onDidChangeTreeData.event;

    private boardStructure: { [platform: string]: { name: string; fqbn: string }[] } = {};
    private dataFetched: boolean = false;
    private filterString: string = '';
    private _view: vscode.TreeView<BoardItem>;

    constructor() {
        this._view = vscode.window.createTreeView('boardSelectorView', {
            treeDataProvider: this,
            showCollapseAll: true
        });
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
        // Optionally update the view title
        if (this._view) {
            this._view.title = this.filterString
                ? `Board Selector (Filter: ${this.filterString})`
                : 'Board Selector';
        }
    }


    getTreeItem(element: BoardItem): vscode.TreeItem {
        return element;
    }

    public clearFilter(): void {
        this.filterString = '';
        this.refresh();
    }

    public showFilterInput(): void {
        const inputBox = vscode.window.createInputBox();
        inputBox.placeholder = 'Type to filter boards';
        inputBox.value = this.filterString;

        inputBox.onDidChangeValue((value) => {
            this.filterString = value;
            this.refresh();
        });

        inputBox.onDidAccept(() => {
            inputBox.dispose();
        });

        inputBox.onDidHide(() => {
            inputBox.dispose();
        });

        inputBox.show();
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

        // Filter and sort boards
        const filteredBoards = boards
            .filter((boardInfo) =>
                boardInfo.name.toLowerCase().includes(this.filterString.toLowerCase())
            )
            .sort((a, b) => a.name.localeCompare(b.name));

        return filteredBoards.map(
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
