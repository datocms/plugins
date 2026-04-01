/**
 * useVendorConfig.ts
 * PERF-003: Custom hook to manage vendor-specific configuration state.
 * Groups related state to reduce re-renders in the parent component.
 */

import { useCallback, useState } from 'react';
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
 * Resolves default values for DeepL-specific configuration fields.
 *
 * @param pluginParams - Plugin configuration parameters from DatoCMS.
 * @returns Partial state containing only DeepL-related defaults.
 */
function resolveDeepLDefaults(pluginParams: ctxParamsType): {
  deeplApiKey: string;
  deeplUseFree: boolean;
  deeplFormality: 'default' | 'more' | 'less';
  deeplPreserveFormatting: boolean;
  deeplIgnoreTags: string;
  deeplNonSplittingTags: string;
  deeplSplittingTags: string;
  deeplGlossaryId: string;
  deeplGlossaryPairs: string;
} {
  return {
    deeplApiKey: pluginParams.deeplApiKey ?? '',
    deeplUseFree: pluginParams.deeplUseFree ?? false,
    deeplFormality: pluginParams.deeplFormality ?? 'default',
    deeplPreserveFormatting: pluginParams.deeplPreserveFormatting ?? true,
    deeplIgnoreTags: pluginParams.deeplIgnoreTags ?? 'notranslate,ph',
    deeplNonSplittingTags:
      pluginParams.deeplNonSplittingTags ??
      'a,code,pre,strong,em,ph,notranslate',
    deeplSplittingTags: pluginParams.deeplSplittingTags ?? '',
    deeplGlossaryId: pluginParams.deeplGlossaryId ?? '',
    deeplGlossaryPairs: pluginParams.deeplGlossaryPairs ?? '',
  };
}

/**
 * Resolves the initial state for the vendor config hook by applying default values
 * to each field from pluginParams. Extracting this into its own function keeps all
 * null-coalescing operators out of the hook body and reduces its cognitive complexity.
 *
 * @param pluginParams - Plugin configuration parameters from DatoCMS.
 * @returns A fully-defaulted VendorConfigState object ready to seed useState calls.
 */
function resolveInitialVendorState(
  pluginParams: ctxParamsType,
): VendorConfigState {
  return {
    vendor: pluginParams.vendor ?? 'openai',
    apiKey: pluginParams.apiKey ?? '',
    gptModel: pluginParams.gptModel ?? 'None',
    googleApiKey: pluginParams.googleApiKey ?? '',
    geminiModel: pluginParams.geminiModel ?? 'gemini-2.5-flash',
    anthropicApiKey: pluginParams.anthropicApiKey ?? '',
    anthropicModel: pluginParams.anthropicModel ?? 'claude-haiku-4-5-latest',
    ...resolveDeepLDefaults(pluginParams),
  };
}

/**
 * Custom hook for managing vendor configuration state.
 * Consolidates all vendor-related state into a single hook to reduce parent re-renders.
 */
export function useVendorConfig(
  pluginParams: ctxParamsType,
): [VendorConfigState, VendorConfigActions] {
  const initial = resolveInitialVendorState(pluginParams);

  const [vendor, setVendor] = useState<VendorType>(initial.vendor);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [gptModel, setGptModel] = useState(initial.gptModel);
  const [googleApiKey, setGoogleApiKey] = useState(initial.googleApiKey);
  const [geminiModel, setGeminiModel] = useState(initial.geminiModel);
  const [anthropicApiKey, setAnthropicApiKey] = useState(
    initial.anthropicApiKey,
  );
  const [anthropicModel, setAnthropicModel] = useState(initial.anthropicModel);
  const [deeplApiKey, setDeeplApiKey] = useState(initial.deeplApiKey);
  const [deeplUseFree, setDeeplUseFree] = useState(initial.deeplUseFree);
  const [deeplFormality, setDeeplFormality] = useState<
    'default' | 'more' | 'less'
  >(initial.deeplFormality);
  const [deeplPreserveFormatting, setDeeplPreserveFormatting] = useState(
    initial.deeplPreserveFormatting,
  );
  const [deeplIgnoreTags, setDeeplIgnoreTags] = useState(
    initial.deeplIgnoreTags,
  );
  const [deeplNonSplittingTags, setDeeplNonSplittingTags] = useState(
    initial.deeplNonSplittingTags,
  );
  const [deeplSplittingTags, setDeeplSplittingTags] = useState(
    initial.deeplSplittingTags,
  );
  const [deeplGlossaryId, setDeeplGlossaryId] = useState(
    initial.deeplGlossaryId,
  );
  const [deeplGlossaryPairs, setDeeplGlossaryPairs] = useState(
    initial.deeplGlossaryPairs,
  );

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
    setDeeplFormality: useCallback(
      (v: 'default' | 'more' | 'less') => setDeeplFormality(v),
      [],
    ),
    setDeeplPreserveFormatting: useCallback(
      (v: boolean) => setDeeplPreserveFormatting(v),
      [],
    ),
    setDeeplIgnoreTags: useCallback((v: string) => setDeeplIgnoreTags(v), []),
    setDeeplNonSplittingTags: useCallback(
      (v: string) => setDeeplNonSplittingTags(v),
      [],
    ),
    setDeeplSplittingTags: useCallback(
      (v: string) => setDeeplSplittingTags(v),
      [],
    ),
    setDeeplGlossaryId: useCallback((v: string) => setDeeplGlossaryId(v), []),
    setDeeplGlossaryPairs: useCallback(
      (v: string) => setDeeplGlossaryPairs(v),
      [],
    ),
  };

  return [state, actions];
}

/**
 * Extracts vendor config params for saving.
 */
export function getVendorConfigParams(
  state: VendorConfigState,
): Partial<ctxParamsType> {
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
