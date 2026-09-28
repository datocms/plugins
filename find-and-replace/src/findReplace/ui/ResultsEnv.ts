import { createContext, useContext } from 'react';
import type { FindReplaceController } from '../contract';
import type { Copy } from './copy';

/** What the result rows need besides their own view: stable for the page's lifetime. */
export type ResultsEnvValue = {
  controller: FindReplaceController;
  copy: Copy;
  /** Same-tab fallback for "Open record" when the internal domain is unknown. */
  navigateTo: (path: string) => void;
};

export const ResultsEnv = createContext<ResultsEnvValue | null>(null);

export function useResultsEnv(): ResultsEnvValue {
  const value = useContext(ResultsEnv);
  if (!value) {
    throw new Error('Result rows must render inside <ResultsEnv.Provider>');
  }
  return value;
}
