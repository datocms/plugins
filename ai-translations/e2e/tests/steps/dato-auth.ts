import { chromium } from '@playwright/test';
import { TIMEOUTS } from '../setup/constants';
import { requireEnv } from '../setup/env';

/**
 * Log in to the DatoCMS dashboard once (headless) and persist the authenticated
 * session to `storagePath`, which every project then reuses via Playwright's
 * `storageState`. TOTP is only attempted when `E2E_DASHBOARD_TOTP_SECRET` is set
 * (2FA is currently off on the E2E account).
 */
export const loginAndSaveState = async (storagePath: string): Promise<void> => {
  const env = requireEnv();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('https://dashboard.datocms.com/login');

    await page.getByRole('textbox', { name: 'Email' }).fill(env.E2E_DASHBOARD_EMAIL);
    await page.getByRole('textbox', { name: 'Password' }).fill(env.E2E_DASHBOARD_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();

    if (env.E2E_DASHBOARD_TOTP_SECRET) {
      // otplib is CJS; pull `authenticator` off its default export, lazily, so
      // the dependency is only touched when 2FA is actually enabled.
      const { authenticator } = (await import('otplib')).default;
      const code = authenticator.generate(env.E2E_DASHBOARD_TOTP_SECRET);
      await page.getByRole('textbox', { name: /code|2fa|authenticator/i }).fill(code);
      await page.getByRole('button', { name: /verify|continue|log in/i }).click();
    }

    // Authenticated landing: the URL leaves /login once credentials are accepted.
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
      timeout: TIMEOUTS.one_min,
    });
    await page.waitForLoadState('networkidle');

    await page.context().storageState({ path: storagePath });
  } finally {
    await browser.close();
  }
};
