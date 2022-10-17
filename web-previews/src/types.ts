export type FirstInstallationParameters = {};

export type Frontend = {
  name: string;
  previewWebhook: string;
};

export type Parameters = {
  frontends: Frontend[];
  startOpen?: boolean;
};

export type PreviewLinks = {
  url: string;
  label: string;
};

export type Response = {
  urls: PreviewLinks[];
};
