import { SITE_ACCESS, hasSiteAccess } from '../shared/permissions';
import { localizePage, t } from '../shared/i18n';
import { renderShortcuts } from '../shared/shortcuts';
import { byId } from '../shared/dom';

const button = byId<HTMLButtonElement>('grant');
const statusEl = byId<HTMLParagraphElement>('status');

async function refresh(): Promise<void> {
  const granted = await hasSiteAccess();
  button.hidden = granted;
  statusEl.textContent = granted ? t('onboardingGranted') : '';
  statusEl.className = granted ? 'ok' : '';
}

button.addEventListener('click', async () => {
  // permissions.request must be called directly from the click handler.
  const granted = await browser.permissions.request(SITE_ACCESS);
  if (!granted) statusEl.textContent = t('onboardingDenied');
  await refresh();
});

localizePage();
renderShortcuts(byId<HTMLTableElement>('shortcuts'));
refresh();
