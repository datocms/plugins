import type { ApiTypes } from '@datocms/cma-client-browser';

type Environment = ApiTypes.Environment;

export const sortByEnvUpdateTime = (a: Environment, b: Environment): number => {
  const timestampA = new Date(a.meta.last_data_change_at).getTime();
  const timestampB = new Date(b.meta.last_data_change_at).getTime();
  return timestampA - timestampB;
};
