export type DeployProvider = "vercel" | "netlify" | "cloudflare";

export type DeployProviderOption = {
  provider: DeployProvider;
  label: string;
  url: string;
};

export const DEPLOY_PROVIDER_OPTIONS: DeployProviderOption[] = [
  {
    provider: "vercel",
    label: "Vercel",
    url: "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Frecord-bin-lambda-function&env=DATOCMS_FULLACCESS_API_TOKEN&project-name=datocms-record-bin-lambda-function&repo-name=datocms-record-bin-lambda-function",
  },
  {
    provider: "netlify",
    label: "Netlify",
    url: "https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/record-bin-lambda-function",
  },
  {
    provider: "cloudflare",
    label: "Cloudflare",
    url: "https://github.com/marcelofinamorvieira/record-bin-lambda-function#deploying-on-cloudflare-workers",
  },
];

export const PLUGIN_README_URL =
  "https://github.com/datocms/plugins/tree/master/record-bin#readme";
