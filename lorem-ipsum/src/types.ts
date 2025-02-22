// Valid field types recognized by the plugin
export type ValidFieldType = 'string' | 'text' | 'structured_text';

// Describes a rule for automatically applying the plugin to a field
export type AutoApplyRule = {
  fieldTypes: ValidFieldType[];
  apiKeyRegexp: string;
};

// Defines what valid plugin configuration might look like
export type ValidConfig = {
  autoApplyRules: AutoApplyRule[];
};

// The plugin config can be either empty or valid
export type Config = {} | ValidConfig;