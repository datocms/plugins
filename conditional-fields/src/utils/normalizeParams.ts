import type { ValidManualExtensionParameters } from '../types';

export default function normalizeParams(
  params: Record<string, unknown>,
): ValidManualExtensionParameters {
  return {
    targetFieldsApiKey:
      'slaveFields' in params && typeof params.slaveFields === 'string'
        ? params.slaveFields.trim().split(/\s*,\s*/)
        : [],
    invert: 'invert' in params && typeof params.invert === 'boolean' ? params.invert : false,
  };
}
