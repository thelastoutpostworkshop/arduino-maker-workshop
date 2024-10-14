
import { TreeDataProvider,EventEmitter,Event,TreeItem,TreeItemCollapsibleState,ThemeIcon } from "vscode";

export class QuickAccessProvider implements TreeDataProvider<QuickAccessItem> {
  private _onDidChangeTreeData: EventEmitter<QuickAccessItem | undefined | null | void> = new EventEmitter<QuickAccessItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<QuickAccessItem | undefined | null | void> = this._onDidChangeTreeData.event;

  getTreeItem(element: QuickAccessItem): TreeItem {
    return element;
  }

  getChildren(element?: QuickAccessItem): Thenable<QuickAccessItem[]> {
    return Promise.resolve(this.getQuickAccessItems());
  }

  private getQuickAccessItems(): QuickAccessItem[] {
    const items = [
      new QuickAccessItem('Arduino Home', 'extension.openVueWebview', 'Open the Arduino Home', 'home'),
      new QuickAccessItem('Compile', 'vscode-arduino.compile', 'Compile the current sketch', 'gear'),
      new QuickAccessItem('Upload', 'vscode-arduino.compile', 'Upload to the board', 'cloud-upload')
    ];
    return items;
  }
}

class QuickAccessItem extends TreeItem {
  constructor(
    public readonly label: string,
    private commandId: string,
    public readonly tooltip?: string,
    private iconName?: string
  ) {
    super(label, TreeItemCollapsibleState.None);

    this.command = {
      command: this.commandId,
      title: this.label
    };

    if (this.iconName) {
      this.iconPath = new ThemeIcon(this.iconName);
    }
  }
}
