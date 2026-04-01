import { describe, expect, it } from 'vitest';
import {
  BACKUPS_LAMBDA_README_URL,
  DEPLOY_PROVIDER_OPTIONS,
  PLUGIN_README_URL,
} from './deployProviders';

describe('DEPLOY_PROVIDER_OPTIONS', () => {
  it('contains the expected providers, labels, and urls', () => {
    expect(DEPLOY_PROVIDER_OPTIONS).toEqual([
      {
        provider: 'vercel',
        label: 'Vercel',
        url: 'https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Fdatocms-backups-scheduled-function&env=DATOCMS_FULLACCESS_API_TOKEN,DATOCMS_BACKUPS_SHARED_SECRET&project-name=datocms-backups-scheduled-function&repo-name=datocms-backups-scheduled-function',
      },
      {
        provider: 'netlify',
        label: 'Netlify',
        url: 'https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function',
      },
      {
        provider: 'cloudflare',
        label: 'Cloudflare',
        url: 'https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#deploying-on-cloudflare-workers',
      },
    ]);
  });
});

describe('README links', () => {
  it('contains valid absolute URLs', () => {
    expect(() => new URL(PLUGIN_README_URL)).not.toThrow();
    expect(() => new URL(BACKUPS_LAMBDA_README_URL)).not.toThrow();
  });
});
