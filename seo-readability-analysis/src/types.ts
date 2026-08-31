export type FirstInstallationParameters = Record<string, never>;

export type CustomHeader = {
  name: string;
  value: string;
};

export type ValidParameters = {
  htmlGeneratorUrl: string;
  customHeaders?: CustomHeader[];
  autoApplyToFieldsWithApiKey?: string | null;
};

export type Parameters = FirstInstallationParameters | ValidParameters;

export type Mark = {
  _properties: {
    marked: string;
    original: string;
  };
};

export type AnalysisResult = {
  text: string;
  score: number;
  _identifier: string;
  marks?: Mark[];
};

export type AnalysisAssessment = {
  score: number;
  results: AnalysisResult[];
};

export type Analysis = {
  readability: AnalysisAssessment;
  seo: AnalysisAssessment;
  relatedKeywordsSeo: AnalysisAssessment[];
};
