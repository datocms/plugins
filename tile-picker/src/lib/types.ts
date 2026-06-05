/** Outcome of a validation pass. */
type Result =
	| {type: 'error'; message: string}
	| {type: 'success'};

/** A color swatch option. */
type ColorOption = {
	name: string;
	type: 'color';
	/** CSS color value, e.g. `green`. */
	color: string;
	/** The string stored in the DatoCMS field when selected. */
	value: string;
};

/** An image thumbnail option. */
type ImageOption = {
	name: string;
	type: 'image';
	/** Image URL, e.g. `https://example.com/icon.svg`. */
	url: string;
	/** The string stored in the DatoCMS field when selected. */
	value: string;
};

type Option = ColorOption | ImageOption;

/** Controls layout in the field editor. */
type Presentation = {
	type?: 'carousel' | 'grid';
	width?: string;
	columns?: number;
};

/** Named list of options defined in plugin settings. */
type Preset = Option[];

/** All presets; key is the preset name. */
type Presets = Record<string, Preset>;

/**
 * Per-field configuration.
 * Options from named presets listed in `presets` are merged before any
 * locally defined `options`.
 */
type FieldConfig = {
	/** Keys of global presets to merge in. */
	presets?: string[];
	/** Options defined directly on this field. */
	options?: Option[];
	/** Layout overrides for this field's editor. */
	presentation?: Presentation;
};

/** Valid (v2) plugin-level parameters. */
type ValidPluginParameters = {
	paramsVersion: '2';
	presets: Presets;
};

/** Legacy (v1) plugin-level parameters — presets stored as a JSON string. */
type LegacyPluginParameters = {
	presets?: string;
	[key: string]: unknown;
};

type PluginParameters = ValidPluginParameters | LegacyPluginParameters;

/** Valid (v2) per-field parameters. */
type ValidFieldParameters = {
	paramsVersion: '2';
	config: FieldConfig;
};

/** Legacy (v1) per-field parameters — config stored as a JSON string under `collection`. */
type LegacyFieldParameters = {
	collection?: string;
	[key: string]: unknown;
};

type FieldParameters = ValidFieldParameters | LegacyFieldParameters;

function isValidPluginParameters(params: unknown): params is ValidPluginParameters {
	return (params as Record<string, unknown>)?.paramsVersion === '2';
}

function normalizePluginParameters(params: unknown): ValidPluginParameters {
	if (isValidPluginParameters(params)) return params;
	const legacy = (params ?? {}) as LegacyPluginParameters;
	let presets: Presets = {};
	if (typeof legacy.presets === 'string') {
		try {
			const parsed = JSON.parse(legacy.presets) as Record<string, Array<Record<string, string>>>;
			presets = Object.fromEntries(
				Object.entries(parsed).map(([key, options]) => [key, options.map(normalizeOption)]),
			);
		} catch { /* fall through */ }
	}
	return {paramsVersion: '2', presets};
}

function isValidFieldParameters(params: unknown): params is ValidFieldParameters {
	return (params as Record<string, unknown>)?.paramsVersion === '2';
}

function normalizeOption(raw: Record<string, string>): Option {
	if (raw.type === 'image') {
		return {name: raw.name ?? '', type: 'image', url: raw.url ?? raw.display ?? '', value: raw.value ?? ''};
	}
	return {name: raw.name ?? '', type: 'color', color: raw.color ?? raw.display ?? '', value: raw.value ?? ''};
}

function normalizeFieldParameters(params: unknown): ValidFieldParameters {
	if (isValidFieldParameters(params)) return params;
	const legacy = (params ?? {}) as LegacyFieldParameters;
	let config: FieldConfig = {};
	if (typeof legacy.collection === 'string' && legacy.collection) {
		try {
			const old = JSON.parse(legacy.collection) as Record<string, unknown>;
			config = {
				presets: old.extends as string[] | undefined,
				options: (old.options as Array<Record<string, string>> | undefined)?.map(normalizeOption),
				presentation: old.presentation as Presentation | undefined,
			};
		} catch { /* fall through */ }
	}
	return {paramsVersion: '2', config};
}

export type {
	Result,
	Option, ColorOption, ImageOption,
	Presentation,
	Preset, Presets,
	FieldConfig,
	PluginParameters, ValidPluginParameters, LegacyPluginParameters,
	FieldParameters, ValidFieldParameters, LegacyFieldParameters,
};

export {
	isValidPluginParameters, normalizePluginParameters,
	isValidFieldParameters, normalizeFieldParameters,
	normalizeOption,
};
