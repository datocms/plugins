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
    /** The original text with Yoast's marks, empty for a mark by position */
    marked: string;
    original: string;
    /** The range of the page's HTML that a mark by position covers */
    position?: { startOffset: number; endOffset: number };
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
