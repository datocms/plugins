import ColorHash from 'color-hash';

// The same hue and the same step of lightness for a model in both color
// schemes: the dark scheme takes lighter steps, thus the color reads on a
// dark surface too
const lightScheme = new ColorHash({ saturation: 1 });
const darkScheme = new ColorHash({ saturation: 1, lightness: [0.6, 0.7, 0.8] });

/**
 * The color of a model in the calendar: a hash of its ID, the same in the
 * list of the models and on its records. It is data, not a theme color, thus
 * no token has it: it has one value for each color scheme, and it only fills
 * the `--model-color` custom property of the swatch and of the bar of a
 * record.
 */
export function colorForModel(modelId: string): string {
  return `light-dark(${lightScheme.hex(modelId)}, ${darkScheme.hex(modelId)})`;
}
