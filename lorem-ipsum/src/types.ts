export type ValidFieldType = 'string' | 'text' | 'structured_text';

export type AutoApplyRule = {
  fieldTypes: ValidFieldType[];
  apiKeyRegexp: string;
};

export type ValidConfig = {
  autoApplyRules: AutoApplyRule[];
};

export type Config = {} | ValidConfig;
