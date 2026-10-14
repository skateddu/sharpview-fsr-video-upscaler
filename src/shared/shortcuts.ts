/** Fills `table` with one row per command: description and current shortcut. */
export async function renderShortcuts(table: HTMLTableElement): Promise<void> {
  const commands = await browser.commands.getAll();
  table.replaceChildren(
    ...commands
      .filter((c) => c.description)
      .map((c) => {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = c.description!;
        const key = document.createElement('td');
        if (c.shortcut) {
          const kbd = document.createElement('kbd');
          kbd.textContent = c.shortcut;
          key.append(kbd);
        } else {
          key.textContent = '—';
          key.className = 'muted';
        }
        tr.append(name, key);
        return tr;
      }),
  );
}

/**
 * Shows the current shortcut of each command in [data-shortcut] elements (as text) and
 * [data-shortcut-title] elements (as tooltip); unassigned ones are hidden.
 */
export async function showShortcuts(root: ParentNode = document): Promise<void> {
  const keys = new Map((await browser.commands.getAll()).map((c) => [c.name, c.shortcut ?? '']));
  for (const el of root.querySelectorAll<HTMLElement>('[data-shortcut]')) {
    el.textContent = keys.get(el.dataset.shortcut!) ?? '';
    el.hidden = !el.textContent;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-shortcut-title]')) {
    const key = keys.get(el.dataset.shortcutTitle!);
    if (key) el.title = key;
    else el.removeAttribute('title');
  }
}

type CommandsWithSettings = typeof browser.commands & { openShortcutSettings?: () => Promise<void> };

/** Whether Firefox can open its shortcut settings page (Firefox 137+). */
export function shortcutSettingsAvailable(): boolean {
  return typeof (browser.commands as CommandsWithSettings).openShortcutSettings === 'function';
}

export function openShortcutSettings(): void {
  (browser.commands as CommandsWithSettings).openShortcutSettings?.();
}
