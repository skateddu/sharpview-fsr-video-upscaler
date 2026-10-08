// Localized strings via browser.i18n (extension/_locales). Outside the extension (test
// harness injected into a page, node tests) it falls back to the English catalog.
import en from '../../extension/_locales/en/messages.json' with { type: 'json' };

export interface CatalogEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const fallback: Record<string, CatalogEntry> = en;

/** Localized message for `key`, with optional substitutions for its placeholders. */
export function t(key: string, substitutions?: string | string[]): string {
  const api = typeof browser === 'undefined' ? undefined : browser.i18n;
  const localized = api?.getMessage(key, substitutions);
  return localized || formatMessage(fallback[key], substitutions) || key;
}

/**
 * Fills elements marked with data-i18n (text) and data-i18n-title / data-i18n-aria-label /
 * data-i18n-placeholder (attributes). The HTML keeps the English text as a fallback.
 */
export function localizePage(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const [attr, data] of [
    ['title', 'i18nTitle'],
    ['aria-label', 'i18nAriaLabel'],
    ['placeholder', 'i18nPlaceholder'],
  ] as const) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-${toKebab(data)}]`)) el.setAttribute(attr, t(el.dataset[data]!));
  }
  document.documentElement.lang = (typeof browser === 'undefined' ? undefined : browser.i18n?.getUILanguage()) ?? 'en';
}

/**
 * Same placeholder rules as browser.i18n: $NAME$ → its content, $1..$9 → substitutions.
 * Self-contained, so scripts/ui-test.mjs can inject it into its simulated `browser.i18n`.
 */
export function formatMessage(entry: CatalogEntry | undefined, substitutions?: string | string[]): string {
  if (!entry) return '';
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const positional = (text: string) => text.replace(/\$(\d)/g, (_, n: string) => subs[Number(n) - 1] ?? '');
  return entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name: string) => {
    const placeholder = entry.placeholders?.[name.toLowerCase()];
    return placeholder ? positional(placeholder.content) : whole;
  });
}

function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
