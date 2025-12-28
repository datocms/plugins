/**
 * Generic filter function that filters items based on multiple string properties.
 * Used to reduce code duplication across user, field, and model filtering.
 *
 * @param items - Array of items to filter
 * @param query - Search query string
 * @param getSearchableStrings - Function that extracts searchable strings from an item
 * @returns Filtered array of items where at least one property matches the query
 */
function filterBySearchableStrings<T>(
  items: T[],
  query: string,
  getSearchableStrings: (item: T) => (string | undefined)[]
): T[] {
  const lowerQuery = query.toLowerCase();
  return items.filter((item) =>
    getSearchableStrings(item).some(
      (str) => str && str.toLowerCase().includes(lowerQuery)
    )
  );
}

/**
 * Filters users based on a search query.
 * Matches against name and email.
 */
export function filterUsers<T extends { name: string; email: string }>(
  users: T[],
  query: string
): T[] {
  return filterBySearchableStrings(users, query, (user) => [user.name, user.email]);
}

/**
 * Filters fields based on a search query.
 * Matches against apiKey, label, and displayLabel (for nested fields).
 */
export function filterFields<
  T extends { apiKey: string; label: string; displayLabel?: string },
>(fields: T[], query: string): T[] {
  return filterBySearchableStrings(fields, query, (field) => [
    field.apiKey,
    field.label,
    field.displayLabel,
  ]);
}

/**
 * Filters models based on a search query.
 * Matches against apiKey and name.
 */
export function filterModels<T extends { apiKey: string; name: string }>(
  models: T[],
  query: string
): T[] {
  return filterBySearchableStrings(models, query, (model) => [model.apiKey, model.name]);
}
