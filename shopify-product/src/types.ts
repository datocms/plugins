export type FirstInstallationParameters = {};

export type ValidParameters = {
  shopifyDomain: string;
  storefrontAccessToken: string;
};

export type ConfigParameters = FirstInstallationParameters | ValidParameters;
