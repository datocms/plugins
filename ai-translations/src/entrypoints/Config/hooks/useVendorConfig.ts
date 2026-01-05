/**
 * useVendorConfig.ts
 * PERF-003: Custom hook to manage vendor-specific configuration state.
 * Groups related state to reduce re-renders in the parent component.
 */

import { useState, useCallback } from 'react';
import type { ctxParamsType } from '../ConfigScreen';

export type VendorType = 'openai' | 'google' | 'anthropic' | 'deepl';

export interface VendorConfigState {
  // Vendor selection
  vendor: VendorType;
  // OpenAI
  apiKey: string;
  gptModel: string;
  // Google/Gemini
  googleApiKey: string;
  geminiModel: string;
  // Anthropic
  anthropicApiKey: string;
  anthropicModel: string;
  // DeepL
  deeplApiKey: string;
  deeplUseFree: boolean;
  deeplFormality: 'default' | 'more' | 'less';
  deeplPreserveFormatting: boolean;
  deeplIgnoreTags: string;
  deeplNonSplittingTags: string;
  deeplSplittingTags: string;
  deeplGlossaryId: string;
  deeplGlossaryPairs: string;
}

export interface VendorConfigActions {
  setVendor: (vendor: VendorType) => void;
  setApiKey: (key: string) => void;
  setGptModel: (model: string) => void;
  setGoogleApiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
  setAnthropicApiKey: (key: string) => void;
  setAnthropicModel: (model: string) => void;
  setDeeplApiKey: (key: string) => void;
  setDeeplUseFree: (value: boolean) => void;
  setDeeplFormality: (value: 'default' | 'more' | 'less') => void;
  setDeeplPreserveFormatting: (value: boolean) => void;
  setDeeplIgnoreTags: (value: string) => void;
  setDeeplNonSplittingTags: (value: string) => void;
  setDeeplSplittingTags: (value: string) => void;
  setDeeplGlossaryId: (value: string) => void;
  setDeeplGlossaryPairs: (value: string) => void;
}

/**
 * Custom hook for managing vendor configuration state.
 * Consolidates all vendor-related state into a single hook to reduce parent re-renders.
 */
export function useVendorConfig(pluginParams: ctxParamsType): [VendorConfigState, VendorConfigActions] {
  const [vendor, setVendor] = useState<VendorType>(pluginParams.vendor ?? 'openai');
  const [apiKey, setApiKey] = useState(pluginParams.apiKey ?? '');
  const [gptModel, setGptModel] = useState(pluginParams.gptModel ?? 'None');
  const [googleApiKey, setGoogleApiKey] = useState(pluginParams.googleApiKey ?? '');
  const [geminiModel, setGeminiModel] = useState(pluginParams.geminiModel ?? 'gemini-1.5-flash');
  const [anthropicApiKey, setAnthropicApiKey] = useState(pluginParams.anthropicApiKey ?? '');
  const [anthropicModel, setAnthropicModel] = useState(pluginParams.anthropicModel ?? 'claude-3.5-haiku-latest');
  const [deeplApiKey, setDeeplApiKey] = useState(pluginParams.deeplApiKey ?? '');
  const [deeplUseFree, setDeeplUseFree] = useState(pluginParams.deeplUseFree ?? false);
  const [deeplFormality, setDeeplFormality] = useState<'default' | 'more' | 'less'>(pluginParams.deeplFormality ?? 'default');
  const [deeplPreserveFormatting, setDeeplPreserveFormatting] = useState(pluginParams.deeplPreserveFormatting ?? true);
  const [deeplIgnoreTags, setDeeplIgnoreTags] = useState(pluginParams.deeplIgnoreTags ?? 'notranslate,ph');
  const [deeplNonSplittingTags, setDeeplNonSplittingTags] = useState(pluginParams.deeplNonSplittingTags ?? 'a,code,pre,strong,em,ph,notranslate');
  const [deeplSplittingTags, setDeeplSplittingTags] = useState(pluginParams.deeplSplittingTags ?? '');
  const [deeplGlossaryId, setDeeplGlossaryId] = useState(pluginParams.deeplGlossaryId ?? '');
  const [deeplGlossaryPairs, setDeeplGlossaryPairs] = useState(pluginParams.deeplGlossaryPairs ?? '');

  const state: VendorConfigState = {
    vendor,
    apiKey,
    gptModel,
    googleApiKey,
    geminiModel,
    anthropicApiKey,
    anthropicModel,
    deeplApiKey,
    deeplUseFree,
    deeplFormality,
    deeplPreserveFormatting,
    deeplIgnoreTags,
    deeplNonSplittingTags,
    deeplSplittingTags,
    deeplGlossaryId,
    deeplGlossaryPairs,
  };

  const actions: VendorConfigActions = {
    setVendor: useCallback((v: VendorType) => setVendor(v), []),
    setApiKey: useCallback((k: string) => setApiKey(k), []),
    setGptModel: useCallback((m: string) => setGptModel(m), []),
    setGoogleApiKey: useCallback((k: string) => setGoogleApiKey(k), []),
    setGeminiModel: useCallback((m: string) => setGeminiModel(m), []),
    setAnthropicApiKey: useCallback((k: string) => setAnthropicApiKey(k), []),
    setAnthropicModel: useCallback((m: string) => setAnthropicModel(m), []),
    setDeeplApiKey: useCallback((k: string) => setDeeplApiKey(k), []),
    setDeeplUseFree: useCallback((v: boolean) => setDeeplUseFree(v), []),
    setDeeplFormality: useCallback((v: 'default' | 'more' | 'less') => setDeeplFormality(v), []),
    setDeeplPreserveFormatting: useCallback((v: boolean) => setDeeplPreserveFormatting(v), []),
    setDeeplIgnoreTags: useCallback((v: string) => setDeeplIgnoreTags(v), []),
    setDeeplNonSplittingTags: useCallback((v: string) => setDeeplNonSplittingTags(v), []),
    setDeeplSplittingTags: useCallback((v: string) => setDeeplSplittingTags(v), []),
    setDeeplGlossaryId: useCallback((v: string) => setDeeplGlossaryId(v), []),
    setDeeplGlossaryPairs: useCallback((v: string) => setDeeplGlossaryPairs(v), []),
  };

  return [state, actions];
}

/**
 * Extracts vendor config params for saving.
 */
export function getVendorConfigParams(state: VendorConfigState): Partial<ctxParamsType> {
  return {
    vendor: state.vendor,
    apiKey: state.apiKey,
    gptModel: state.gptModel,
    googleApiKey: state.googleApiKey,
    geminiModel: state.geminiModel,
    anthropicApiKey: state.anthropicApiKey,
    anthropicModel: state.anthropicModel,
    deeplApiKey: state.deeplApiKey,
    deeplUseFree: state.deeplUseFree,
    deeplFormality: state.deeplFormality,
    deeplPreserveFormatting: state.deeplPreserveFormatting,
    deeplIgnoreTags: state.deeplIgnoreTags,
    deeplNonSplittingTags: state.deeplNonSplittingTags,
    deeplSplittingTags: state.deeplSplittingTags,
    deeplGlossaryId: state.deeplGlossaryId,
    deeplGlossaryPairs: state.deeplGlossaryPairs,
  };
}
