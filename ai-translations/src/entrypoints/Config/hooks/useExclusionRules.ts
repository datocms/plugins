/**
 * useExclusionRules.ts
 * PERF-003: Custom hook to manage exclusion rules configuration state.
 * Groups related state to reduce re-renders in the parent component.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { ctxParamsType } from '../ConfigScreen';

export interface ExclusionRulesState {
  modelsToBeExcluded: string[];
  rolesToBeExcluded: string[];
  apiKeysToBeExcluded: string[];
  showExclusionRules: boolean;
  hasExclusionRules: boolean;
}

export interface ExclusionRulesActions {
  setModelsToBeExcluded: (models: string[]) => void;
  setRolesToBeExcluded: (roles: string[]) => void;
  setApiKeysToBeExcluded: (keys: string[]) => void;
  setShowExclusionRules: (show: boolean) => void;
  resetExclusionRules: () => void;
}

/**
 * Custom hook for managing exclusion rules state.
 * Consolidates model, role, and field exclusions into a single hook.
 */
export function useExclusionRules(pluginParams: ctxParamsType): [ExclusionRulesState, ExclusionRulesActions] {
  const [modelsToBeExcluded, setModelsToBeExcluded] = useState<string[]>(
    pluginParams.modelsToBeExcludedFromThisPlugin ?? []
  );

  const [rolesToBeExcluded, setRolesToBeExcluded] = useState<string[]>(
    pluginParams.rolesToBeExcludedFromThisPlugin ?? []
  );

  const [apiKeysToBeExcluded, setApiKeysToBeExcluded] = useState<string[]>(
    pluginParams.apiKeysToBeExcludedFromThisPlugin ?? []
  );

  const [showExclusionRules, setShowExclusionRules] = useState<boolean>(false);

  // Calculate if any exclusion rules are set
  const hasExclusionRules = useMemo(() => {
    return (
      modelsToBeExcluded.length > 0 ||
      rolesToBeExcluded.length > 0 ||
      apiKeysToBeExcluded.length > 0
    );
  }, [modelsToBeExcluded, rolesToBeExcluded, apiKeysToBeExcluded]);

  // Force show exclusion rules if any are set
  useEffect(() => {
    if (hasExclusionRules) {
      setShowExclusionRules(true);
    }
  }, [hasExclusionRules]);

  const state: ExclusionRulesState = {
    modelsToBeExcluded,
    rolesToBeExcluded,
    apiKeysToBeExcluded,
    showExclusionRules,
    hasExclusionRules,
  };

  const actions: ExclusionRulesActions = {
    setModelsToBeExcluded: useCallback((m: string[]) => setModelsToBeExcluded(m), []),
    setRolesToBeExcluded: useCallback((r: string[]) => setRolesToBeExcluded(r), []),
    setApiKeysToBeExcluded: useCallback((k: string[]) => setApiKeysToBeExcluded(k), []),
    setShowExclusionRules: useCallback((s: boolean) => setShowExclusionRules(s), []),
    resetExclusionRules: useCallback(() => {
      setModelsToBeExcluded([]);
      setRolesToBeExcluded([]);
      setApiKeysToBeExcluded([]);
    }, []),
  };

  return [state, actions];
}

/**
 * Extracts exclusion rules params for saving.
 */
export function getExclusionRulesParams(state: ExclusionRulesState): Partial<ctxParamsType> {
  return {
    modelsToBeExcludedFromThisPlugin: state.modelsToBeExcluded,
    rolesToBeExcludedFromThisPlugin: state.rolesToBeExcluded,
    apiKeysToBeExcludedFromThisPlugin: state.apiKeysToBeExcluded,
  };
}
