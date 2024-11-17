import { TreeDataProvider, EventEmitter, Event, TreeItem, TreeItemCollapsibleState, ThemeIcon, ThemeColor } from "vscode";

export const compileCommandName = 'Compile';
export const uploadCommandName = 'Upload';
export const homeCommandName = 'Arduino Home';
export const intellisenseCommandName = 'intellisense';

export class QuickAccessProvider implements TreeDataProvider<QuickAccessItem> {
  private _onDidChangeTreeData: EventEmitter<QuickAccessItem | undefined | null | void> = new EventEmitter<QuickAccessItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<QuickAccessItem | undefined | null | void> = this._onDidChangeTreeData.event;


  // State to track disabled items
  private disabledItemsState: { [key: string]: boolean } = {
    compileCommandName: true,
    uploadCommandName: true,
    homeCommandName:false,
    intellisenseCommandName:true,
  };

  getTreeItem(element: QuickAccessItem): TreeItem {
    return element;
  }

  getChildren(element?: QuickAccessItem): Thenable<QuickAccessItem[]> {
    return Promise.resolve(this.getQuickAccessItems());
  }

  // Modify the getQuickAccessItems to use the disabledItemsState object
  private getQuickAccessItems(): QuickAccessItem[] {
    const items = [
      new QuickAccessItem(homeCommandName, 'extension.openVueWebview', 'Open the Arduino Home', 'home', this.disabledItemsState[homeCommandName]),
      new QuickAccessItem(compileCommandName, 'quickAccessView.compile', 'Compile the current sketch', 'check', this.disabledItemsState[compileCommandName]),
      new QuickAccessItem(uploadCommandName, 'quickAccessView.upload', 'Upload to the board', 'cloud-upload', this.disabledItemsState[uploadCommandName]),
      new QuickAccessItem(intellisenseCommandName, intellisenseCommandName, 'Generate Intellisense file', 'bug', this.disabledItemsState[intellisenseCommandName]),
    ];
    return items;
  }

  // Method to refresh the view
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // Public method to disable an item
  disableItem(label: string) {
    this.disabledItemsState[label] = true;
    this.refresh();
  }

  // Public method to enable an item
  enableItem(label: string) {
    this.disabledItemsState[label] = false;
    this.refresh();
  }
}

class QuickAccessItem extends TreeItem {
  constructor(
    public readonly label: string,
    private commandId: string,
    public readonly tooltip?: string,
    private iconName?: string,
    private disabled: boolean = false
  ) {
    super(label, TreeItemCollapsibleState.None);

    if (!disabled) {
      this.command = {
        command: this.commandId,
        title: this.label
      };
    } else {
      // Update the label to show it's disabled and apply the grey color
      this.label = `${this.label}`;
      this.tooltip = `${this.tooltip} - disabled, not an Arduino Project`;
      if (this.iconName) {
        this.iconPath = new ThemeIcon(this.iconName, new ThemeColor('disabledForeground'));
      }
    }

    if (this.iconName && !disabled) {
      this.iconPath = new ThemeIcon(this.iconName);
    }

    this.contextValue = disabled ? 'disabled' : 'enabled';
  }
}
