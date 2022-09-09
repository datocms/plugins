import {
  LegacyManualExtensionParameters,
  ValidManualExtensionParameters,
} from "../types";

export default function normalizeParams(
  params: LegacyManualExtensionParameters
): ValidManualExtensionParameters {
  return {
    targetFieldsApiKey:
      "slaveFields" in params ? params.slaveFields.trim().split(/\s*,\s*/) : [],
    invert: "invert" in params ? params.invert : false,
  };
}
