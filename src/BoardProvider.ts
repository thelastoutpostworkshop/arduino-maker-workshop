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
            showCollapseAll: true,
        });
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);

        // Update the view title to show the filter (optional)
        if (this._view) {
            this._view.title = this.filterString
                ? `Board Selector (Filter: ${this.filterString})`
                : 'Board Selector';
        }
    }

    getTreeItem(element: BoardItem): vscode.TreeItem {
        // Create a new TreeItem with the updated collapsibleState
        const treeItem = new vscode.TreeItem(
            element.label,
            element.collapsibleState
        );

        treeItem.contextValue = element.contextValue;
        treeItem.command = element.command;
        treeItem.iconPath = element.iconPath;
        treeItem.id = element.id;

        return treeItem;
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

        return platformNames.map((platformName) => {
            let collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

            if (this.filterString.trim() !== '') {
                const hasMatchingBoards = this.boardStructure[platformName].some((boardInfo) =>
                    boardInfo.name.toLowerCase().includes(this.filterString.toLowerCase())
                );

                if (!hasMatchingBoards) {
                    collapsibleState = vscode.TreeItemCollapsibleState.None;
                }
            }

            return new BoardItem(platformName, collapsibleState, 'platform');
        });
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

    public showFilterInput(): void {
        const inputBox = vscode.window.createInputBox();
        inputBox.placeholder = 'Type to filter boards';
        inputBox.value = this.filterString;

        inputBox.onDidChangeValue(async (value) => {
            this.filterString = value;
            this.refresh();

            // Expand matching platforms after a brief delay
            setTimeout(() => {
                this.expandMatchingPlatforms();
            }, 100);
        });

        inputBox.onDidAccept(() => {
            inputBox.dispose();
        });

        inputBox.onDidHide(() => {
            inputBox.dispose();
        });

        inputBox.show();
    }

    private expandMatchingPlatforms(): void {
        if (this.filterString.trim() === '') {
            // Do not expand platforms when the filter is empty
            return;
        }

        const platformItems = this.getPlatforms();

        for (const platformItem of platformItems) {
            const hasMatchingBoards = this.boardStructure[platformItem.label].some((boardInfo) =>
                boardInfo.name.toLowerCase().includes(this.filterString.toLowerCase())
            );

            if (hasMatchingBoards) {
                // Programmatically expand the platform
                this._view.reveal(platformItem, { expand: true }).catch((error) => {
                    // Handle any errors (e.g., item not found)
                });
            }
        }
    }

    public clearFilter(): void {
        this.filterString = '';
        this.refresh();
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
                arguments: [this],
            };
        }

        // Optionally set an icon
        if (this.contextValue === 'platform') {
            this.iconPath = new vscode.ThemeIcon('layers');
        } else if (this.contextValue === 'board') {
            this.iconPath = new vscode.ThemeIcon('circuit-board');
        }

        // Assign a unique ID
        this.id = this.getId();
    }

    private getId(): string {
        if (this.contextValue === 'platform') {
            return `platform_${this.label}`;
        } else if (this.contextValue === 'board') {
            return `board_${this.fqbn}`;
        }
        return `item_${this.label}`;
    }
}
