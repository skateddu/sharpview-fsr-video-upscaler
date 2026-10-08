/** Access to all sites: the content script needs it to find the videos on web pages. */
export const SITE_ACCESS: browser.permissions.Permissions = { origins: ['<all_urls>'] };

export function hasSiteAccess(): Promise<boolean> {
  return browser.permissions.contains(SITE_ACCESS);
}

/** Opens the welcome page, where site access can be granted (from a page, not the popup). */
export function openOnboarding(): Promise<unknown> {
  return browser.tabs.create({ url: browser.runtime.getURL('onboarding.html') });
}
