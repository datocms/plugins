export type FirstInstallationParameters = {};

export type ValidParameters = {
  baseEndpoint: string;
  clientId: string;
};

export type ConfigParameters = FirstInstallationParameters | ValidParameters;
