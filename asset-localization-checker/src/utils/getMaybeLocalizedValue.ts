export const getMaybeLocalizedValue = (
  formValues: Record<string, unknown>,
  fieldPath: string,
): unknown => {
  const [field, locale] = fieldPath.split('.');
  const fieldValue = formValues[field];
  if (locale) {
    const localizedRecord = fieldValue as Record<string, unknown>;
    return localizedRecord[locale];
  }
  return fieldValue;
};
