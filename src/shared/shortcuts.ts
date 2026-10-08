// Table of the extension's shortcuts, as currently set in Firefox (the user can change them).
// Descriptions come from the manifest, already localized.

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

type CommandsWithSettings = typeof browser.commands & { openShortcutSettings?: () => Promise<void> };

/** Whether Firefox can open its shortcut settings page (Firefox 137+). */
export function shortcutSettingsAvailable(): boolean {
  return typeof (browser.commands as CommandsWithSettings).openShortcutSettings === 'function';
}

export function openShortcutSettings(): void {
  (browser.commands as CommandsWithSettings).openShortcutSettings?.();
}
