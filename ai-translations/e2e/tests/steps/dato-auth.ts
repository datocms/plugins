import { chromium } from '@playwright/test';
import { PROJECT_SUBDOMAIN, TIMEOUTS } from '../setup/constants';
import { requireEnv } from '../setup/env';
import { phase } from '../setup/log';

/**
 * Log in to the **project admin** (`<subdomain>.admin.datocms.com`) once and
 * persist the session to `storagePath`, which every project reuses via
 * `storageState`. This is a different origin/session from the account dashboard
 * — the record editor lives here, so this is the session the suite needs.
 *
 * The sign-in inputs carry no accessible name, so they're located by `name`
 * attribute. TOTP is only attempted when `E2E_DASHBOARD_TOTP_SECRET` is set
 * (2FA is currently off).
 */
export const loginAndSaveState = async (storagePath: string): Promise<void> => {
  const env = requireEnv();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    phase(`logging in as ${env.E2E_DASHBOARD_EMAIL} at ${PROJECT_SUBDOMAIN()}.admin.datocms.com…`);
    await page.goto(`https://${PROJECT_SUBDOMAIN()}.admin.datocms.com/sign_in`);

    await page.locator('input[name="email"]').fill(env.E2E_DASHBOARD_EMAIL);
    await page.locator('input[name="password"]').fill(env.E2E_DASHBOARD_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();

    if (env.E2E_DASHBOARD_TOTP_SECRET) {
      // otplib is CJS; resolve `authenticator` from either interop shape lazily,
      // so the dependency is only touched when 2FA is actually enabled.
      type OtpLib = { authenticator: { generate(secret: string): string } };
      const mod = (await import('otplib')) as unknown as Partial<OtpLib> & { default?: OtpLib };
      const authenticator = mod.default?.authenticator ?? mod.authenticator;
      if (!authenticator) throw new Error('otplib.authenticator unavailable');
      const code = authenticator.generate(env.E2E_DASHBOARD_TOTP_SECRET);
      await page.getByRole('textbox', { name: /code|2fa|authenticator/i }).fill(code);
      await page.getByRole('button', { name: /verify|continue|login/i }).click();
    }

    // Authenticated once the URL leaves the sign-in page.
    await page.waitForURL((url) => !url.pathname.endsWith('/sign_in'), {
      timeout: TIMEOUTS.one_min,
    });
    await page.waitForLoadState('networkidle');

    await page.context().storageState({ path: storagePath });
    phase('login succeeded — session saved ✓');
  } finally {
    await browser.close();
  }
};
