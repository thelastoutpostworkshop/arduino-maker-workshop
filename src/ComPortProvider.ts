import * as vscode from 'vscode';

class ComPortProvider implements vscode.TreeDataProvider<ComPortItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ComPortItem | undefined | null | void> = new vscode.EventEmitter<ComPortItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ComPortItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ComPortItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ComPortItem): Promise<ComPortItem[]> {
    if (element) {
      // No child elements
      return [];
    } else {
      // Root elements: list COM ports
      const ports = await list();
      return ports.map(port => new ComPortItem(port.path, vscode.TreeItemCollapsibleState.None));
    }
  }
}

class ComPortItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.contextValue = 'comPortItem';
  }
}
