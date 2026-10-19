export type LengthLimit = {
  min?: number;
  max?: number;
};

export type LengthStatus = 'ok' | 'under' | 'over';

export type SeoPartResult = {
  count: number;
  limit: LengthLimit;
  status: LengthStatus;
};

export type SeoAnalysis = {
  title: SeoPartResult;
  description: SeoPartResult;
};

/** Validator names that turn on the counter for SEO fields. */
export const SEO_LENGTH_VALIDATORS = [
  'title_length',
  'description_length',
] as const;

/**
 * Reads a `{ min, max }` length validator, keeping only numeric bounds.
 * Returns an empty limit when the validator is missing or malformed.
 */
export const readLengthLimit = (validator: unknown): LengthLimit => {
  if (typeof validator !== 'object' || validator === null) {
    return {};
  }

  const { min, max } = validator as Record<string, unknown>;

  return {
    ...(typeof min === 'number' ? { min } : {}),
    ...(typeof max === 'number' ? { max } : {}),
  };
};

/**
 * Compares a character count against a limit.
 * Empty values never count as too short: `required_seo_fields` covers that.
 */
export const getLengthStatus = (
  count: number,
  limit: LengthLimit,
): LengthStatus => {
  if (limit.max !== undefined && count > limit.max) {
    return 'over';
  }

  if (limit.min !== undefined && count > 0 && count < limit.min) {
    return 'under';
  }

  return 'ok';
};

const readString = (value: unknown, key: string): string => {
  if (typeof value !== 'object' || value === null) {
    return '';
  }

  const part = (value as Record<string, unknown>)[key];
  return typeof part === 'string' ? part : '';
};

const analyzePart = (count: number, validator: unknown): SeoPartResult => {
  const limit = readLengthLimit(validator);
  return { count, limit, status: getLengthStatus(count, limit) };
};

/**
 * Counts SEO title and description characters and checks them against the
 * field's `title_length` / `description_length` validators, if any.
 */
export const analyzeSeoValue = (
  value: unknown,
  validators: Record<string, unknown>,
): SeoAnalysis => ({
  title: analyzePart(
    readString(value, 'title').length,
    validators.title_length,
  ),
  description: analyzePart(
    readString(value, 'description').length,
    validators.description_length,
  ),
});
