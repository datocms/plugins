/**
 * useFeatureToggles.ts
 * PERF-003: Custom hook to manage feature toggle configuration state.
 * Groups related state to reduce re-renders in the parent component.
 */

import { useCallback, useState } from 'react';
import type { ctxParamsType } from '../ConfigScreen';
import { translateFieldTypes } from '../configConstants';

export interface FeatureToggleState {
  translationFields: string[];
  translateWholeRecord: boolean;
  translateBulkRecords: boolean;
  prompt: string;
  enableDebugging: boolean;
}

export interface FeatureToggleActions {
  setTranslationFields: (fields: string[]) => void;
  setTranslateWholeRecord: (value: boolean) => void;
  setTranslateBulkRecords: (value: boolean) => void;
  setPrompt: (prompt: string) => void;
  setEnableDebugging: (value: boolean) => void;
  resetToDefaults: () => void;
}

/**
 * Custom hook for managing feature toggle state.
 * Consolidates translation fields and feature flags into a single hook.
 */
export function useFeatureToggles(
  pluginParams: ctxParamsType,
  defaultPrompt: string,
): [FeatureToggleState, FeatureToggleActions] {
  const [translationFields, setTranslationFields] = useState<string[]>(
    Array.isArray(pluginParams.translationFields)
      ? pluginParams.translationFields
      : Object.keys(translateFieldTypes),
  );

  const [translateWholeRecord, setTranslateWholeRecord] = useState<boolean>(
    typeof pluginParams.translateWholeRecord === 'boolean'
      ? pluginParams.translateWholeRecord
      : true,
  );

  const [translateBulkRecords, setTranslateBulkRecords] = useState<boolean>(
    typeof pluginParams.translateBulkRecords === 'boolean'
      ? pluginParams.translateBulkRecords
      : true,
  );

  const [prompt, setPrompt] = useState(pluginParams.prompt ?? defaultPrompt);

  const [enableDebugging, setEnableDebugging] = useState<boolean>(
    typeof pluginParams.enableDebugging === 'boolean'
      ? pluginParams.enableDebugging
      : false,
  );

  const state: FeatureToggleState = {
    translationFields,
    translateWholeRecord,
    translateBulkRecords,
    prompt,
    enableDebugging,
  };

  const actions: FeatureToggleActions = {
    setTranslationFields: useCallback(
      (f: string[]) => setTranslationFields(f),
      [],
    ),
    setTranslateWholeRecord: useCallback(
      (v: boolean) => setTranslateWholeRecord(v),
      [],
    ),
    setTranslateBulkRecords: useCallback(
      (v: boolean) => setTranslateBulkRecords(v),
      [],
    ),
    setPrompt: useCallback((p: string) => setPrompt(p), []),
    setEnableDebugging: useCallback((v: boolean) => setEnableDebugging(v), []),
    resetToDefaults: useCallback(() => {
      setTranslationFields(Object.keys(translateFieldTypes));
      setTranslateWholeRecord(true);
      setTranslateBulkRecords(true);
      setPrompt(defaultPrompt);
    }, [defaultPrompt]),
  };

  return [state, actions];
}

/**
 * Extracts feature toggle params for saving.
 */
export function getFeatureToggleParams(
  state: FeatureToggleState,
): Partial<ctxParamsType> {
  return {
    translationFields: state.translationFields,
    translateWholeRecord: state.translateWholeRecord,
    translateBulkRecords: state.translateBulkRecords,
    prompt: state.prompt,
    enableDebugging: state.enableDebugging,
  };
}
