export type DeployProvider = 'vercel' | 'netlify' | 'cloudflare';

export type DeployProviderOption = {
  provider: DeployProvider;
  label: string;
  url: string;
};

export const DEPLOY_PROVIDER_OPTIONS: DeployProviderOption[] = [
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
];

export const PLUGIN_README_URL =
  'https://github.com/datocms/plugins/tree/master/automatic-environment-backups';

export const BACKUPS_LAMBDA_README_URL =
  'https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function#readme';
