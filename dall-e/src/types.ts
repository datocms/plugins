import type { SupportedImageModel } from './utils/openaiImages';

export type ConfigParameters = {
  apiKey?: string;
  model?: SupportedImageModel;
};
