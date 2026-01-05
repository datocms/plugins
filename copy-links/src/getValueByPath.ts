import type { ItemFormAdditionalProperties } from "datocms-plugin-sdk";

type FormValues = ItemFormAdditionalProperties["formValues"];

/**
 * Walks a dot-delimited path into your formValues using a reducer.
 *
 * @example
 * const title = getValueByPath<string>(ctx.formValues, "author.profile.name");
 */
export const getValueByPath = <T = unknown>(
  formValues: FormValues,
  path: string,
): T =>
  path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc as Record<string, unknown>)?.[key],
      formValues,
    ) as T;
