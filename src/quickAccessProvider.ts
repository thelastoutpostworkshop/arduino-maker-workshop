import { TreeDataProvider, EventEmitter, Event, TreeItem, TreeItemCollapsibleState, ThemeIcon, ThemeColor } from "vscode";
import { arduinoProject } from "./extension";
import { ARDUINO_ERRORS } from "./ArduinoProject";

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
    const arduinoProjectValid = arduinoProject.isFolderArduinoProject() === ARDUINO_ERRORS.NO_ERRORS;

    const items = [
      new QuickAccessItem('Arduino Home', 'extension.openVueWebview', 'Open the Arduino Home', 'home'),
      new QuickAccessItem('Compile', 'quickAccessView.compile', 'Compile the current sketch', 'check', !arduinoProjectValid),
      new QuickAccessItem('Upload', 'quickAccessView.upload', 'Upload to the board', 'cloud-upload', !arduinoProjectValid)
    ];
    return items;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
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
      this.description = '(Disabled)';
    }

    if (this.iconName) {
      this.iconPath = new ThemeIcon(this.iconName, disabled ? new ThemeColor('disabledForeground') : undefined);
    }

    this.contextValue = disabled ? 'disabled' : 'enabled';
  }
}
