import ColorHash from "color-hash";

const colorHash = new ColorHash({ saturation: 1 });

export function colorForModel(modelId: string) {
  return colorHash.rgb(modelId);
}