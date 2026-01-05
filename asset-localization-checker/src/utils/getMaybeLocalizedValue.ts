export const getMaybeLocalizedValue = (
  formValues: Record<string, any>,
  fieldPath: string,
): unknown => {
  const [field, locale] = fieldPath.split(".");
  return locale ? formValues[field][locale] : formValues[field];
};
