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
  'updated_at'
];

export const criteriaLabel: Record<Criteria, string> = {
  publication_scheduled_at: 'Scheduled publishing date',
  first_published_at: 'First publish date',
  published_at: 'Last publish date',
  created_at: 'Creation date',
  updated_at: 'Last update date'
};

export type ActiveModels = 'all' | string[];