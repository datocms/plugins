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

/** Filters by name and email. */
export function filterUsers<T extends { name: string; email: string }>(
  users: T[],
  query: string
): T[] {
  return filterBySearchableStrings(users, query, (user) => [user.name, user.email]);
}

/** Filters by apiKey, label, and displayLabel. */
export function filterFields<
  T extends { apiKey: string; label: string; displayLabel?: string },
>(fields: T[], query: string): T[] {
  return filterBySearchableStrings(fields, query, (field) => [
    field.apiKey,
    field.label,
    field.displayLabel,
  ]);
}

/** Filters by apiKey and name. */
export function filterModels<T extends { apiKey: string; name: string }>(
  models: T[],
  query: string
): T[] {
  return filterBySearchableStrings(models, query, (model) => [model.apiKey, model.name]);
}
