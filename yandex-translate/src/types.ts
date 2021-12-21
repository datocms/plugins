export type FirstInstallationParameters = {};

export type ValidParameters = {
  developmentMode: boolean;
  yandexApiKey?: string | null;
};

export type ConfigParameters = FirstInstallationParameters | ValidParameters;
