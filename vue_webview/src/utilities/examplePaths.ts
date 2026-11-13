interface ExampleItem {
  title: string;
  value: string;
}

export type ExampleListItem = ExampleItem
  | { type: 'subheader'; title: string }
  | { type: 'divider' };

function exampleParts(example: string, installDir?: string): string[] {
  // Normalize only the display path; the original path is used to open the example.
  const displayPath = example.replace(/\\/g, '/').replace(/\/+$/, '');
  if (installDir) {
    const libraryPath = installDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const isWindowsPath = /^[a-z]:\//i.test(displayPath)
      || displayPath.startsWith('//') || example.includes('\\');
    const compare = (value: string) => isWindowsPath ? value.toLowerCase() : value;
    if (compare(displayPath).startsWith(`${compare(libraryPath)}/`)) {
      const parts = displayPath.slice(libraryPath.length + 1).split('/').filter(Boolean);
      return parts[0]?.toLowerCase() === 'examples' && parts.length > 1
        ? parts.slice(1) : parts;
    }
  }

  // Older or incomplete library metadata may not include the installation folder.
  const parts = displayPath.split('/').filter(Boolean);
  const examplesIndex = parts.map(part => part.toLowerCase()).lastIndexOf('examples');
  return examplesIndex >= 0 && examplesIndex < parts.length - 1
    ? parts.slice(examplesIndex + 1) : parts.slice(-1);
}

export function examplesItems(examples: string[], installDir?: string): ExampleListItem[] {
  const ungrouped: ExampleItem[] = [];
  const groups = new Map<string, ExampleItem[]>();
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

  for (const example of examples) {
    const parts = exampleParts(example, installDir);
    if (parts.length <= 1) {
      ungrouped.push({ title: parts[0] ?? example, value: example });
      continue;
    }

    const groupName = parts[0];
    const group = groups.get(groupName) ?? [];
    group.push({ title: parts.slice(1).join(' / '), value: example });
    groups.set(groupName, group);
  }

  const items: ExampleListItem[] = ungrouped.sort((a, b) => compare(a.title, b.title));
  for (const [title, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
    items.push({ type: 'subheader', title });
    items.push(...group.sort((a, b) => compare(a.title, b.title)));
    items.push({ type: 'divider' });
  }
  return items;
}
