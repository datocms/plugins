export type Criteria =
  | 'publication_scheduled_at'
  | 'first_published_at'
  | 'published_at'
  | 'created_at'
  | 'updated_at';

export const allCriteria: Criteria[] = [
  'publication_scheduled_at',
  'first_published_at',
  'published_at',
  'created_at',
  'updated_at',
];

export function isCriteria(value: unknown): value is Criteria {
  return allCriteria.includes(value as Criteria);
}

/** The name of each date, as an option of the menu */
export const criteriaLabel: Record<Criteria, string> = {
  publication_scheduled_at: 'Scheduled publication date',
  first_published_at: 'First publication date',
  published_at: 'Last publication date',
  created_at: 'Creation date',
  updated_at: 'Last update date',
};

/** The current date, as the text of the menu trigger */
export const criteriaTriggerLabel: Record<Criteria, string> = {
  publication_scheduled_at: 'By scheduled publication',
  first_published_at: 'By first publication',
  published_at: 'By last publication',
  created_at: 'By creation date',
  updated_at: 'By last update',
};

export type ActiveModels = 'all' | string[];

export function isActiveModels(value: unknown): value is ActiveModels {
  return (
    value === 'all' ||
    (Array.isArray(value) && value.every((id) => typeof id === 'string'))
  );
}
