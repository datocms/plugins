/** Converts snake_case field type to sentence case for display. */
export function formatFieldType(fieldType: string | undefined): string | null {
  if (!fieldType) return null;
  const formatted = fieldType.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
