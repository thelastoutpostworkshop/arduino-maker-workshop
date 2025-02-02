import { TreeDataProvider, EventEmitter, Event, TreeItem, TreeItemCollapsibleState, ThemeIcon, ThemeColor } from "vscode";
import { compileCommandName, uploadCommandName } from "./extension";

export const quickAccessCompileCommandName = 'Compile';
export const compileCommandCleanName = 'Compile (clean)';
export const quickAccessUploadCommandName = 'Upload';
export const homeCommandName = 'Maker Workshop Home';

export class QuickAccessProvider implements TreeDataProvider<QuickAccessItem> {
  private _onDidChangeTreeData: EventEmitter<QuickAccessItem | undefined | null | void> = new EventEmitter<QuickAccessItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<QuickAccessItem | undefined | null | void> = this._onDidChangeTreeData.event;


  // State to track disabled items
  private disabledItemsState: { [key: string]: boolean } = {
    compileCommandName: true,
    uploadCommandName: true,
    homeCommandName: false,
    intellisenseCommandName: true,
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
      new QuickAccessItem(homeCommandName, 'extension.openVueWebview', 'Open Arduino Maker Workshop', 'home', this.disabledItemsState[homeCommandName]),
      new QuickAccessItem(quickAccessCompileCommandName, compileCommandName, 'Compile the current sketch', 'check', this.disabledItemsState[quickAccessCompileCommandName]),
      new QuickAccessItem(compileCommandCleanName, 'compile.clean', 'Compile (rebuild clean) the current sketch', 'check', this.disabledItemsState[compileCommandCleanName]),
      new QuickAccessItem(quickAccessUploadCommandName, uploadCommandName, 'Upload to the board', 'cloud-upload', this.disabledItemsState[quickAccessUploadCommandName]),
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
      this.tooltip = `${this.tooltip} - disabled`;
      if (this.label === quickAccessCompileCommandName || this.label === compileCommandCleanName) {
        this.tooltip = `${this.tooltip} - select a board first in Home`;
      }
      if (this.label === quickAccessUploadCommandName) {
        this.tooltip = `${this.tooltip} - Last compile must be successful, cannot upload`;
      }

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
