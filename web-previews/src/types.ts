export type FirstInstallationParameters = {};

export type Parameters = {
  previewsWebhook: string;
  startOpen?: boolean;
  frontends: {
    name: string;
    previewUrl: string;
  }[];
};

export type PreviewLinks = {
  url: string;
  label: string;
};

export type Response = {
  urls: PreviewLinks[];
};
