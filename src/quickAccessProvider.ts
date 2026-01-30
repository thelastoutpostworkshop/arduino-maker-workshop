import { TreeDataProvider, EventEmitter, Event, TreeItem, TreeItemCollapsibleState, ThemeIcon, ThemeColor } from "vscode";
import { compileCommandName, profileActivateCommandName, profileDeactivateCommandName, uploadCommandName } from "./extension";

export const primaryCompileTitle = 'Compile';
export const primaryCompileCleanTitle = 'Compile (clean)';
export const primaryUploadTitle = 'Upload';
export const primaryHomeTitle = 'Maker Workshop Home';

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

  // Per-item tooltip overrides (keyed by label for consistency with your other maps)
  private tooltipState: { [key: string]: string } = {
    [primaryHomeTitle]: 'Open Arduino Maker Workshop',
    [primaryCompileTitle]: 'Compile the current sketch',
    [primaryCompileCleanTitle]: 'Compile (rebuild clean) the current sketch',
    [primaryUploadTitle]: 'Upload to the board',
    // You can prefill others or leave them undefined
  };

  /** Set/override a tooltip for an item (by label) */
  setTooltip(label: string, tooltip: string) {
    this.tooltipState[label] = tooltip;
    this.refresh();
  }

  /** Remove a custom tooltip so the default is used again */
  resetTooltip(label: string) {
    delete this.tooltipState[label];
    this.refresh();
  }


  // Track visibility separately from disabled state
  private hiddenItemsState: { [key: string]: boolean } = {
    // default: both visible; adjust as you wish
    [profileActivateCommandName]: false,
    [profileDeactivateCommandName]: false,
  };

  // Show/hide API
  hideItem(label: string) {
    this.hiddenItemsState[label] = true;
    this.refresh();
  }
  showItem(label: string) {
    this.hiddenItemsState[label] = false;
    this.refresh();
  }

  getTreeItem(element: QuickAccessItem): TreeItem {
    return element;
  }

  getChildren(element?: QuickAccessItem): Thenable<QuickAccessItem[]> {
    return Promise.resolve(this.getQuickAccessItems());
  }

  private getQuickAccessItems(): QuickAccessItem[] {
    const t = this.tooltipState; // shorthand

    const items: QuickAccessItem[] = [
      new QuickAccessItem(
        primaryHomeTitle,
        'extension.openVueWebview',
        t[primaryHomeTitle] ?? 'Open Arduino Maker Workshop',
        'home',
        this.disabledItemsState[primaryHomeTitle]
      ),
      new QuickAccessItem(
        primaryCompileTitle,
        compileCommandName,
        t[primaryCompileTitle] ?? 'Compile the current sketch',
        'check',
        this.disabledItemsState[primaryCompileTitle]
      ),
      new QuickAccessItem(
        primaryCompileCleanTitle,
        'compile.clean',
        t[primaryCompileCleanTitle] ?? 'Compile (rebuild clean) the current sketch',
        'check',
        this.disabledItemsState[primaryCompileCleanTitle]
      ),
      new QuickAccessItem(
        primaryUploadTitle,
        uploadCommandName,
        t[primaryUploadTitle] ?? 'Upload to the board',
        'cloud-upload',
        this.disabledItemsState[primaryUploadTitle]
      ),
    ];

    if (!this.hiddenItemsState[profileActivateCommandName]) {
      items.push(
        new QuickAccessItem(
          "Activate Build Profiles",
          profileActivateCommandName,
          this.tooltipState["Activate Build Profiles"] ?? 'Select to activate build profiles',
          'symbol-array',
          this.disabledItemsState[profileActivateCommandName]
        )
      );
    }
    if (!this.hiddenItemsState[profileDeactivateCommandName]) {
      items.push(
        new QuickAccessItem(
          "Deactivate Build Profiles",
          profileDeactivateCommandName,
          this.tooltipState["Deactivate Build Profiles"] ?? 'Select to deactivate build profiles',
          'symbol-array',
          this.disabledItemsState[profileDeactivateCommandName]
        )
      );
    }

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
    const baseTooltip = tooltip ?? label;
    this.tooltip = baseTooltip;

    if (!disabled && this.commandId) {
      this.command = {
        command: this.commandId,
        title: this.label
      };
    } else if (disabled) {
      // Update the label to show it's disabled and apply the grey color
      this.label = `${this.label}`;
      this.tooltip = `${baseTooltip} - disabled`;
      if (this.label === primaryCompileTitle || this.label === primaryCompileCleanTitle) {
        this.tooltip = `${this.tooltip} - select a board first in Home`;
      }
      if (this.label === primaryUploadTitle) {
        this.tooltip = `${this.tooltip} - Last compile must be successful, cannot upload`;
      }
    }

    if (this.iconName) {
      this.iconPath = disabled
        ? new ThemeIcon(this.iconName, new ThemeColor('disabledForeground'))
        : new ThemeIcon(this.iconName);
    }

    this.contextValue = disabled ? 'disabled' : 'enabled';
  }
}
