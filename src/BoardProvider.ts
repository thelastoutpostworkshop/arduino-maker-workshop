// BoardProvider.ts
import { loadArduinoConfiguration } from './extension';
import { arduinoProject } from './extension';
import * as vscode from 'vscode';

export class BoardProvider implements vscode.TreeDataProvider<BoardItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BoardItem | undefined | void> =
    new vscode.EventEmitter<BoardItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BoardItem | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BoardItem): vscode.TreeItem {
    return element;
  }

   getChildren(element?: BoardItem): Thenable<BoardItem[]> {
    if (element) {
      // Return children of the given element
      return Promise.resolve(this.getBoardChildren(element));
    } else {
      // Return root elements (boards)
      return Promise.resolve(this.getBoards());
    }
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
    public contextValue: string
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;

    // Assign a command if needed
    if (this.contextValue === 'option') {
      this.command = {
        command: 'boardSelector.selectOption',
        title: 'Select Option',
        arguments: [this]
      };
    }
  }
}
