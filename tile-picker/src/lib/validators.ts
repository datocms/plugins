import { isArray, isPlainObject, isString } from "remeda";
import lang, {
  EN_DATA_NOT_OBJECT,
  EN_FIELD_IS_NOT_ARRAY,
  EN_FIELD_IS_NOT_STRING_ARRAY,
  EN_OPTION_INVALID_TYPE,
  EN_OPTION_MISSING_FIELD,
  EN_OPTION_NON_STRING_FIELD,
  EN_PRESET_NOT_ARRAY,
  EN_OPTION_DATA_NOT_OBJECT,
  EN_INVALID_PRESENTATION_PARAMETERS,
  EN_PRESENTTION_IS_NOT_OBJECT,
} from "../lang";
import type { Result } from "./types";

const VALID_OPTION_KEYS = ["name", "type", "display", "value"];
const VALID_OPTION_TYPES = ["color", "image"];
const VALID_PRESENTATION_KEYS = ["type", "columns", "width"];

const error = (message: string): Result => ({ type: "error", message });

const validateOption = (data: unknown, index: number): Result => {
  if (!isPlainObject(data)) {
    return error(lang(EN_OPTION_DATA_NOT_OBJECT, { index: `${index}` }));
  }

  const d = data as Record<string, unknown>;

  for (let i = 0; i < VALID_OPTION_KEYS.length; i++) {
    const value = d[VALID_OPTION_KEYS[i]];

    if (value === undefined) {
      return error(
        lang(EN_OPTION_MISSING_FIELD, {
          index: `${index}`,
          field: VALID_OPTION_KEYS[i],
        }),
      );
    }

    if (!isString(value)) {
      return error(
        lang(EN_OPTION_NON_STRING_FIELD, {
          index: `${index}`,
          field: VALID_OPTION_KEYS[i],
        }),
      );
    }
  }

  if (isString(d.type) && !VALID_OPTION_TYPES.includes(d.type)) {
    return error(
      lang(EN_OPTION_INVALID_TYPE, { index: `${index}`, type: d.type }),
    );
  }

  return { type: "success" };
};

const validatePresetsConfig = (data: unknown): Result => {
  if (!isPlainObject(data)) {
    return error(lang(EN_DATA_NOT_OBJECT, { field: "Preset" }));
  }

  const d = data as Record<string, unknown>;
  const presets = Object.keys(d);

  for (let i = 0; i < presets.length; i++) {
    const preset = d[presets[i]];

    if (!isArray(preset)) {
      return error(lang(EN_PRESET_NOT_ARRAY, { index: `${i}` }));
    }

    for (let j = 0; j < preset.length; j++) {
      const result = validateOption(preset[j], j);
      if (result.type === "error") {
        return result;
      }
    }
  }

  return { type: "success" };
};

const validateFieldConfig = (data: unknown): Result => {
  if (!isPlainObject(data)) {
    return error(lang(EN_DATA_NOT_OBJECT, { field: "Config" }));
  }

  const d = data as Record<string, unknown>;

  if (d.extends !== undefined && !isArray(d.extends)) {
    return error(lang(EN_FIELD_IS_NOT_ARRAY, { field: "Extends" }));
  }

  if (
    d.extends !== undefined &&
    isArray(d.extends) &&
    !d.extends.every(isString)
  ) {
    return error(lang(EN_FIELD_IS_NOT_STRING_ARRAY, { field: "Extends" }));
  }

  if (d.options !== undefined && !isArray(d.options)) {
    return error(lang(EN_FIELD_IS_NOT_ARRAY, { field: "Options" }));
  }

  if (d.options !== undefined && isArray(d.options)) {
    for (let i = 0; i < d.options.length; i++) {
      const result = validateOption(d.options[i], i);
      if (result.type === "error") {
        return result;
      }
    }
  }

  if (d.presentation !== undefined && !isPlainObject(d.presentation)) {
    return error(lang(EN_PRESENTTION_IS_NOT_OBJECT));
  }

  if (
    d.presentation !== undefined &&
    !Object.keys(d.presentation as object).every((key) =>
      VALID_PRESENTATION_KEYS.includes(key),
    )
  ) {
    return error(lang(EN_INVALID_PRESENTATION_PARAMETERS));
  }

  return { type: "success" };
};

export { validatePresetsConfig, validateOption, validateFieldConfig };
