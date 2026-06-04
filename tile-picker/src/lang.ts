
const EN_NO_VALUE_MATCH = 'It appears that the current value of this field ("::value") does not match any of the available options.';
const EN_PLEASE_SELECT_OPTION = 'Please select another option below.';
const EN_JSON_PARSE_ERROR = 'Could not parse JSON data';
const EN_NO_OPTIONS = 'There are no options available for this field.';
const EN_SETTINGS_UPDATED = 'Settings updated successfully!';
const EN_SAVE_SETTINGS = 'Save settings';
const EN_FIELD_CONFIGURATION = 'Field Configuration';
const EN_OPTION_MISSING_FIELD = 'Option at position ::index is missing the "::field" field';
const EN_OPTION_NON_STRING_FIELD = 'Option at position ::index has a non-string "::field" field';
const EN_OPTION_INVALID_TYPE = 'Option at position ::index has an invalid type "::type"';
const EN_OPTION_DATA_NOT_OBJECT = 'Option at position ::index is not an object';
const EN_PRESET_NOT_ARRAY = 'Preset at position ::index is not an array';
const EN_DATA_NOT_OBJECT = '::field data is not an object';
const EN_FIELD_IS_NOT_ARRAY = '"::field" is not an array';
const EN_FIELD_IS_NOT_STRING_ARRAY = '"::field" is not an array of strings';
const EN_PRESENTTION_IS_NOT_OBJECT = 'Presentation is not an object';
const EN_INVALID_PRESENTATION_PARAMETERS = 'The presentation contains invalid parameters';

const lang = (
	template: string,
	tokens: Record<string, string> = {},
): string => {
	const tokenKeys = Object.keys(tokens);

	if (tokenKeys.length === 0) {
		return template;
	}

	return tokenKeys.reduce((str, tokenKey) => {
		const value = tokens[tokenKey];

		return str.replace(`::${tokenKey}`, value);
	}, template);
};

export default lang;

export {
	EN_PRESENTTION_IS_NOT_OBJECT,
	EN_INVALID_PRESENTATION_PARAMETERS,
	EN_NO_VALUE_MATCH,
	EN_PLEASE_SELECT_OPTION,
	EN_JSON_PARSE_ERROR,
	EN_NO_OPTIONS,
	EN_SETTINGS_UPDATED,
	EN_SAVE_SETTINGS,
	EN_FIELD_CONFIGURATION,
	EN_DATA_NOT_OBJECT,
	EN_OPTION_DATA_NOT_OBJECT,
	EN_OPTION_MISSING_FIELD,
	EN_OPTION_NON_STRING_FIELD,
	EN_OPTION_INVALID_TYPE,
	EN_PRESET_NOT_ARRAY,
	EN_FIELD_IS_NOT_ARRAY,
	EN_FIELD_IS_NOT_STRING_ARRAY,
};
