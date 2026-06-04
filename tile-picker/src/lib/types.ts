/** How an option is rendered visually in the field editor. */
type VisualizationType = 'color' | 'image';

/** Outcome of a JSON validation pass. */
type Result =
	| {type: 'error'; message: string}
	| {type: 'success'};

/** A single selectable option shown in the field editor. */
type Option = {
	/** Label displayed below the visual swatch. */
	name: string;
	/** Rendering strategy: a color swatch or an image thumbnail. */
	type: VisualizationType;
	/**
	 * The value used to render the visual.
	 * For `color`: a CSS hex string (e.g. `#bada55`).
	 * For `image`: a URL (e.g. `https://example.com/icon.svg`).
	 */
	display: string;
	/** The string stored in the DatoCMS field when this option is selected. */
	value: string;
};

/** Controls how the option grid or carousel is laid out in the field editor. */
type Presentation = {
	/**
	 * Layout mode.
	 * `grid` arranges options in a fixed-column grid; `carousel` lays them out
	 * horizontally and allows horizontal scrolling.
	 * Defaults to `'grid'`.
	 */
	type?: 'carousel' | 'grid';
	/**
	 * Width of each option card. Only used when `type` is `'carousel'`.
	 * Defaults to `'250px'`.
	 */
	width?: string;
	/**
	 * Number of columns. Only used when `type` is `'grid'`.
	 * Defaults to `6`.
	 */
	columns?: number;
};

/**
 * The per-field JSON configuration stored in `ctx.parameters.collection`.
 * Options from named presets listed in `extends` are merged before any
 * locally defined `options`.
 */
type Collection = {
	/**
	 * Keys of global presets (defined in plugin settings) to merge in.
	 * Defaults to `[]` (no presets).
	 */
	extends?: string[];
	/**
	 * Options defined directly on this field, appended after any preset options.
	 * Defaults to `[]` (no additional options).
	 */
	options?: Option[];
	/**
	 * Layout overrides for this field's editor.
	 * Defaults to `{}` (all `Presentation` defaults apply).
	 */
	presentation?: Presentation;
};

/**
 * The global presets dictionary stored in `ctx.plugin.attributes.parameters.presets`
 * as a JSON string. Each key is a preset name; the value is the list of options
 * that fields can pull in via `Collection.extends`.
 */
type Presets = Record<string, Option[]>;

/** Plugin-level parameters stored in `ctx.plugin.attributes.parameters`. */
type PluginParameters = {
	/**
	 * JSON-serialised `Presets` dictionary.
	 * Absent on a fresh install; treated as `{}` (no presets) when missing.
	 */
	presets?: string;
};

/** Per-field parameters stored in `ctx.parameters`. */
type FieldParameters = {
	/** JSON-serialised `Collection` object. */
	collection: string;
};

export type {Result, VisualizationType, Option, Collection, Presets, PluginParameters, FieldParameters};
