/**
 * DeepLConfig.tsx
 * Configuration component for DeepL vendor settings: the settings group with
 * the API key, its test, the endpoint and the formality, then the groups that
 * open and close for the tag handling and the glossaries. A passed key test
 * is a toast (a finished action); a failed one is the error of the key
 * field until the key or the endpoint changes.
 */

import type { ApiTypes } from '@datocms/cma-client-browser';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import RadioGroupInput, {
  type RadioGroupOption,
} from 'datocms-react-ui/RadioGroupInput';
import SelectInput from 'datocms-react-ui/SelectInput';
import StringInput from 'datocms-react-ui/StringInput';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useEffect, useId, useMemo, useState } from 'react';
import { useBusyFocus } from '../../../utils/retryFocus';
import {
  DEEPL_DEFAULT_IGNORE_TAGS,
  DEEPL_DEFAULT_NON_SPLITTING_TAGS,
  type DeepLFormalitySetting,
} from '../../../utils/translation/DeepLSettings';
import styles from '../Config.module.css';
import { vendorSettingsTitle } from '../configConstants';
import GlossaryPairEditor, {
  glossaryNoOptionsMessage,
  glossaryOptionsFrom,
  glossaryPairErrors,
  parseRows,
  rawOption,
} from './GlossaryPairEditor';
import { useDeepLGlossaries } from './useDeepLGlossaries';

const FORMALITY_OPTIONS: RadioGroupOption<DeepLFormalitySetting>[] = [
  { label: 'Default', value: 'default' },
  { label: 'More formal', value: 'more' },
  { label: 'Less formal', value: 'less' },
];

/**
 * A default tag list for a hint: "notranslate, ph". The hint names the
 * default, since an emptied list is saved empty and then sends no tags.
 */
function tagListHint(tags: string): string {
  return tags.split(',').join(', ');
}

type ApiKeyTestStatus = 'success' | 'error';

interface ApiKeyTestResult {
  status: ApiKeyTestStatus;
  message: string;
}

interface DeepLTestResponse {
  body: Record<string, unknown> | null;
  parseFailed: boolean;
  status: number;
  ok: boolean;
}

function getDeepLTestBaseUrl(useFreeEndpoint: boolean): string {
  return useFreeEndpoint
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';
}

function parseResponseBody(json: unknown): Record<string, unknown> | null {
  return json && typeof json === 'object'
    ? (json as Record<string, unknown>)
    : null;
}

async function requestDeepLTest(
  apiKey: string,
  useFreeEndpoint: boolean,
): Promise<DeepLTestResponse> {
  const deeplApiUrl = `${getDeepLTestBaseUrl(useFreeEndpoint)}/v2/translate`;
  const url = `https://cors-proxy.datocms.com/?url=${encodeURIComponent(deeplApiUrl)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `DeepL-Auth-Key ${apiKey}`,
    },
    body: JSON.stringify({ text: ['Hello world'], target_lang: 'DE' }),
  });

  try {
    return {
      body: parseResponseBody(await res.json()),
      parseFailed: false,
      status: res.status,
      ok: res.ok,
    };
  } catch {
    return {
      body: null,
      parseFailed: true,
      status: res.status,
      ok: res.ok,
    };
  }
}

function getDeepLErrorMessage(
  body: Record<string, unknown> | null,
): string | undefined {
  if (!body || typeof body.message !== 'string') return undefined;

  const errorMessage = body.message.toLowerCase();

  if (errorMessage.includes('wrong endpoint')) {
    return 'This key is for the other DeepL plan. Change “Key from the DeepL Free plan”, then test the key again.';
  }

  if (errorMessage.includes('forbidden')) {
    return "DeepL rejected the API key. Check that it's the right key.";
  }

  return `DeepL error: ${body.message}`;
}

function getTranslationSample(
  body: Record<string, unknown> | null,
): string | null {
  const translations = body?.translations;
  if (
    !Array.isArray(translations) ||
    translations.length === 0 ||
    typeof (translations[0] as Record<string, unknown>)?.text !== 'string'
  ) {
    return null;
  }

  return (translations[0] as Record<string, unknown>).text as string;
}

/** The toast of a passed test. */
const API_KEY_OK = 'The DeepL API key works.';

function validateDeepLTestResponse(
  response: DeepLTestResponse,
): ApiKeyTestResult {
  if (response.parseFailed) {
    return {
      status: 'error',
      message: `DeepL returned a non-JSON response (HTTP ${response.status}).`,
    };
  }

  const deepLErrorMessage = getDeepLErrorMessage(response.body);
  if (deepLErrorMessage) return { status: 'error', message: deepLErrorMessage };

  if (!response.ok) {
    return {
      status: 'error',
      message: `DeepL returned an error (HTTP ${response.status}). Check the API key and the endpoint.`,
    };
  }

  const sample = getTranslationSample(response.body);
  if (sample === null) {
    return {
      status: 'error',
      message:
        'DeepL returned an unexpected response. Check the API key and the endpoint.',
    };
  }

  return { status: 'success', message: API_KEY_OK };
}

async function testDeepLApiKey(
  apiKey: string,
  useFreeEndpoint: boolean,
): Promise<ApiKeyTestResult> {
  return validateDeepLTestResponse(
    await requestDeepLTest(apiKey, useFreeEndpoint),
  );
}

export interface DeepLConfigProps {
  deeplApiKey: string;
  setDeeplApiKey: (value: string) => void;
  deeplUseFree: boolean;
  setDeeplUseFree: (value: boolean) => void;
  deeplFormality: DeepLFormalitySetting;
  setDeeplFormality: (value: DeepLFormalitySetting) => void;
  deeplPreserveFormatting: boolean;
  setDeeplPreserveFormatting: (value: boolean) => void;
  deeplIgnoreTags: string;
  setDeeplIgnoreTags: (value: string) => void;
  deeplNonSplittingTags: string;
  setDeeplNonSplittingTags: (value: string) => void;
  deeplSplittingTags: string;
  setDeeplSplittingTags: (value: string) => void;
  deeplGlossaryId: string;
  setDeeplGlossaryId: (value: string) => void;
  deeplGlossaryPairs: string;
  setDeeplGlossaryPairs: (value: string) => void;
  siteLocales: ApiTypes.Site['locales'];
  /** Shows a toast (`ctx.notice`): the result of a passed test. */
  notice: (message: string) => unknown;
}

/** The kit's text inputs give null for an empty value: the settings keep ''. */
const toText =
  (setter: (value: string) => void) =>
  (value: string | null): void =>
    setter(value ?? '');

export default function DeepLConfig({
  deeplApiKey,
  setDeeplApiKey,
  deeplUseFree,
  setDeeplUseFree,
  deeplFormality,
  setDeeplFormality,
  deeplPreserveFormatting,
  setDeeplPreserveFormatting,
  deeplIgnoreTags,
  setDeeplIgnoreTags,
  deeplNonSplittingTags,
  setDeeplNonSplittingTags,
  deeplSplittingTags,
  setDeeplSplittingTags,
  deeplGlossaryId,
  setDeeplGlossaryId,
  deeplGlossaryPairs,
  setDeeplGlossaryPairs,
  siteLocales,
  notice,
}: DeepLConfigProps) {
  const [showTags, setShowTags] = useState(false);
  const [showGlossaries, setShowGlossaries] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [autoToggledFree, setAutoToggledFree] = useState(false);
  // "Test API key" is found by its id, not a ref: while it is disabled with
  // a reason, the kit's tooltip clones it and reads `element.ref`, which
  // React 19 warns about.
  const testId = useId();
  const testDisabled = deeplApiKey
    ? undefined
    : { reason: 'Enter a DeepL API key first.' };
  // The busy button is disabled, which drops its focus: once the test ends,
  // the button takes it back (a failure is the error of the key field, which
  // the field announces).
  const followTest = useBusyFocus(
    isTesting,
    () => document.getElementById(testId),
    testDisabled?.reason,
  );

  // Shared glossary data for both the default glossary dropdown and per-pair editor
  const { glossaries, fetchStatus } = useDeepLGlossaries(
    deeplApiKey,
    deeplUseFree,
  );

  // Glossary sizes get the separators of the language of the Canvas.
  const { locale } = useCtx().ui;
  const glossaryOptions = useMemo(
    () => glossaryOptionsFrom(glossaries, locale),
    [glossaries, locale],
  );

  // The saved default glossary, checked against the loaded list
  const isDefaultGlossaryUnknown =
    Boolean(deeplGlossaryId) &&
    fetchStatus === 'success' &&
    !glossaries.some((g) => g.glossary_id === deeplGlossaryId);

  // The fetch error shows once, on the default glossary, in plain words: the
  // key is the usual cause.
  const defaultGlossaryError =
    fetchStatus === 'error'
      ? "Couldn't load the glossaries. Check the API key above."
      : isDefaultGlossaryUnknown
        ? "This glossary isn't in your DeepL account."
        : undefined;

  // A saved glossary or language pair that is no longer valid keeps the
  // glossaries open, so the error shows.
  const hasInvalidGlossaries = useMemo(
    () =>
      isDefaultGlossaryUnknown ||
      glossaryPairErrors(
        parseRows(deeplGlossaryPairs),
        siteLocales,
        glossaries,
        fetchStatus,
      ).some(Boolean),
    [
      isDefaultGlossaryUnknown,
      deeplGlossaryPairs,
      siteLocales,
      glossaries,
      fetchStatus,
    ],
  );

  // Once fixed, the group stays open where the user is working
  useEffect(() => {
    if (hasInvalidGlossaries) setShowGlossaries(true);
  }, [hasInvalidGlossaries]);

  const handleApiKeyChange = (input: string | null) => {
    const value = input ?? '';
    setDeeplApiKey(value);
    setTestError(null);
    if (value.endsWith(':fx') && !deeplUseFree) {
      setDeeplUseFree(true);
      setAutoToggledFree(true);
    } else if (!value.endsWith(':fx') && autoToggledFree) {
      setAutoToggledFree(false);
    }
  };

  const handleUseFreeChange = (value: boolean | null) => {
    setDeeplUseFree(value === true);
    // The test result was for the other endpoint
    setTestError(null);
  };

  // The button is busy while the test runs. The state is the component's,
  // not the kit's (an `onClick` that returns a promise), so the focus comes
  // back in the commit that turns the button on again.
  const handleTestApiKey = async () => {
    if (!deeplApiKey || isTesting) return;
    setTestError(null);
    followTest();
    setIsTesting(true);
    let result: ApiKeyTestResult;
    try {
      result = await testDeepLApiKey(deeplApiKey, deeplUseFree);
    } catch (err) {
      result = {
        status: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while testing the API key.',
      };
    } finally {
      setIsTesting(false);
    }
    if (result.status === 'success') {
      notice(result.message);
    } else {
      setTestError(result.message);
    }
  };

  return (
    <>
      <Page.Group title={vendorSettingsTitle('deepl')}>
        <FieldWrapper label="API key" required error={testError ?? undefined}>
          <StringInput
            code
            name="deeplApiKey"
            value={deeplApiKey}
            onChange={handleApiKeyChange}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
            autoComplete="off"
            spellCheck={false}
          />
        </FieldWrapper>
        <div className={styles.block}>
          <Button
            id={testId}
            label="Test API key"
            busy={isTesting}
            disabled={testDisabled}
            onClick={() => {
              void handleTestApiKey();
            }}
          />
        </div>
        <FieldWrapper
          hint={
            autoToggledFree && deeplUseFree
              ? 'Turned on because the key ends in :fx, like the keys of the Free plan.'
              : 'Turns on by itself for keys that end in :fx.'
          }
        >
          <SwitchInput
            name="deeplUseFree"
            label="Key from the DeepL Free plan"
            value={deeplUseFree}
            onChange={handleUseFreeChange}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Formality"
          hint="Some languages have no formal and informal forms. They keep DeepL's usual tone."
        >
          <RadioGroupInput
            name="deeplFormality"
            value={deeplFormality}
            onChange={(next) => {
              if (next) setDeeplFormality(next);
            }}
            options={FORMALITY_OPTIONS}
          />
        </FieldWrapper>
      </Page.Group>

      <Page.Group
        title="Tag handling"
        collapse={{ open: showTags, onToggle: () => setShowTags((v) => !v) }}
      >
        <FieldWrapper hint="DeepL keeps the punctuation and the casing of the source text, where it would otherwise correct them.">
          <SwitchInput
            name="deeplPreserveFormatting"
            label="Preserve formatting"
            value={deeplPreserveFormatting}
            onChange={(next) => setDeeplPreserveFormatting(next === true)}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Ignored tags"
          hint={`The content of these tags isn't translated. Default: ${tagListHint(DEEPL_DEFAULT_IGNORE_TAGS)}.`}
        >
          <StringInput
            code
            name="deeplIgnoreTags"
            value={deeplIgnoreTags}
            onChange={toText(setDeeplIgnoreTags)}
            spellCheck={false}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Non-splitting tags"
          hint={`These tags never split a sentence. Default: ${tagListHint(DEEPL_DEFAULT_NON_SPLITTING_TAGS)}.`}
        >
          <StringInput
            code
            name="deeplNonSplittingTags"
            value={deeplNonSplittingTags}
            onChange={toText(setDeeplNonSplittingTags)}
            spellCheck={false}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Splitting tags"
          hint="These tags always start a new sentence."
        >
          <StringInput
            code
            name="deeplSplittingTags"
            value={deeplSplittingTags}
            onChange={toText(setDeeplSplittingTags)}
            placeholder="p,li"
            spellCheck={false}
          />
        </FieldWrapper>
      </Page.Group>

      <Page.Group
        title="Glossaries"
        collapse={{
          open: showGlossaries || hasInvalidGlossaries,
          // An invalid saved glossary keeps the group open
          onToggle: hasInvalidGlossaries
            ? undefined
            : () => setShowGlossaries((v) => !v),
        }}
      >
        <FieldWrapper
          label="Default glossary"
          hint="DeepL uses it when no language pair below matches the translation."
          error={defaultGlossaryError}
        >
          <SelectInput
            name="deeplGlossaryId"
            value={deeplGlossaryId || null}
            onChange={(next) => setDeeplGlossaryId(next ?? '')}
            options={glossaryOptions}
            acceptValueNotIncludedInOptions={rawOption}
            loading={fetchStatus === 'loading'}
            noOptionsMessage={glossaryNoOptionsMessage(fetchStatus)}
            clearable
            placeholder="Pick a glossary"
          />
        </FieldWrapper>
        <GlossaryPairEditor
          value={deeplGlossaryPairs}
          onChange={setDeeplGlossaryPairs}
          siteLocales={siteLocales}
          glossaries={glossaries}
          fetchStatus={fetchStatus}
        />
      </Page.Group>
    </>
  );
}
