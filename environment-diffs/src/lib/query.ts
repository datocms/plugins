import type { FilterValue, PageQueryState } from '../types';

const VALID_FILTERS: FilterValue[] = [
  'all',
  'changed',
  'leftOnly',
  'rightOnly',
  'unchanged',
];

export function parsePageQueryState(search: string): PageQueryState {
  const params = new URLSearchParams(search);
  const filterCandidate = params.get('filter') as FilterValue | null;

  return {
    leftEnv: params.get('leftEnv') ?? undefined,
    rightEnv: params.get('rightEnv') ?? undefined,
    filter: VALID_FILTERS.includes(filterCandidate ?? 'changed')
      ? (filterCandidate ?? 'changed')
      : 'changed',
    entityType: params.get('entityType') ?? undefined,
    entityId: params.get('entityId') ?? undefined,
  };
}

export function resolveEnvironmentPair(
  environments: string[],
  currentEnvironment: string,
  query: Pick<PageQueryState, 'leftEnv' | 'rightEnv'>,
) {
  if (environments.length < 2) {
    return null;
  }

  const leftEnv =
    query.leftEnv && environments.includes(query.leftEnv)
      ? query.leftEnv
      : environments.includes(currentEnvironment)
        ? currentEnvironment
        : environments[0];

  const preferredRight =
    query.rightEnv && environments.includes(query.rightEnv)
      ? query.rightEnv
      : environments.find((environment) => environment !== leftEnv);

  if (!preferredRight || preferredRight === leftEnv) {
    const fallbackRight = environments.find(
      (environment) => environment !== leftEnv,
    );

    if (!fallbackRight) {
      return null;
    }

    return {
      leftEnv,
      rightEnv: fallbackRight,
    };
  }

  return {
    leftEnv,
    rightEnv: preferredRight,
  };
}
