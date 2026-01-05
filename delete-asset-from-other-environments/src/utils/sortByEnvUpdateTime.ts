import type { Environment } from "@datocms/cma-client/dist/types/generated/ApiTypes";

export const sortByEnvUpdateTime = (a: Environment, b: Environment): number => {
  const timestampA = new Date(a.meta.last_data_change_at).getTime();
  const timestampB = new Date(b.meta.last_data_change_at).getTime();
  return timestampA - timestampB;
};