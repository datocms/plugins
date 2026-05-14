/**
 * DeepLConfig.tsx
 * Configuration component for DeepL vendor settings.
 */

import {Button, Section, SelectField, SwitchField, TextField} from 'datocms-react-ui';
import {useMemo, useState} from 'react';
import type {ApiTypes} from '@datocms/cma-client-browser';
import {RESPONSE_PREVIEW_MAX_LENGTH} from '../../../utils/constants';
import s from '../../styles.module.css';
import GlossaryPairEditor from './GlossaryPairEditor';
import {useDeepLGlossaries} from './useDeepLGlossaries';

type SelectOption = { label: string; value: string };
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
    return 'Your API key requires the DeepL Free endpoint. Enable "Use DeepL Free endpoint (api-free.deepl.com)" below, then try again.';
  }

  if (errorMessage.includes('forbidden')) {
    return 'The DeepL API key is invalid. Please check that you entered the correct key.';
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

function getSuccessMessage(sample: string): string {
  if (!sample) return 'API Key OK. DeepL responded (empty body).';

  return `API Key OK. DeepL responded: ${sample.slice(0, RESPONSE_PREVIEW_MAX_LENGTH)}${sample.length > RESPONSE_PREVIEW_MAX_LENGTH ? '…' : ''}`;
}

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
      message:
        `DeepL returned an error (HTTP ${response.status}). Verify your API key and endpoint settings.`,
    };
  }

  const sample = getTranslationSample(response.body);
  if (sample === null) {
    return {
      status: 'error',
      message:
        'DeepL returned an unexpected response. The API key or endpoint may be misconfigured.',
    };
  }

  return { status: 'success', message: getSuccessMessage(sample) };
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
  deeplFormality: 'default' | 'more' | 'less';
  setDeeplFormality: (value: 'default' | 'more' | 'less') => void;
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
  openConfirm: (options: {
    title: string;
    content: string;
    choices: {
      label: string;
      value: unknown;
      intent?: 'positive' | 'negative';
    }[];
    cancel: { label: string; value: unknown };
  }) => Promise<unknown>;
}

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
  openConfirm,
}: DeepLConfigProps) {
  const [showTags, setShowTags] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [testApiKeyMessage, setTestApiKeyMessage] = useState('');
  const [testApiKeyStatus, setTestApiKeyStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [autoToggledFree, setAutoToggledFree] = useState(false);

  // Shared glossary data for both the default glossary dropdown and per-pair editor
  const { glossaries, fetchStatus, fetchError } =
    useDeepLGlossaries(deeplApiKey, deeplUseFree);

  const glossaryOptions: SelectOption[] = useMemo(
    () =>
      glossaries.map((g) => ({
        label: `${g.name} (${g.source_lang}\u2192${g.target_lang}, ${g.entry_count} entries)`,
        value: g.glossary_id,
      })),
    [glossaries],
  );

  // Build value for the default glossary dropdown
  const defaultGlossaryValue = deeplGlossaryId
    ? glossaryOptions.find((o) => o.value === deeplGlossaryId) ?? {
        label: deeplGlossaryId,
        value: deeplGlossaryId,
      }
    : null;

  // Validate the current default glossary ID against fetched list
  const defaultGlossaryError =
    deeplGlossaryId &&
    fetchStatus === 'success' &&
    !glossaries.some((g) => g.glossary_id === deeplGlossaryId)
      ? `"${deeplGlossaryId}" is not a valid glossary in your DeepL account`
      : undefined;

  const handleApiKeyChange = (value: string) => {
    setDeeplApiKey(value);
    if (testApiKeyStatus === 'error') {
      setTestApiKeyStatus('idle');
      setTestApiKeyMessage('');
    }
    if (value.endsWith(':fx') && !deeplUseFree) {
      setDeeplUseFree(true);
      setAutoToggledFree(true);
    } else if (!value.endsWith(':fx') && autoToggledFree) {
      setAutoToggledFree(false);
    }
  };

  const handleTestApiKey = async () => {
    if (!deeplApiKey) {
      setTestApiKeyStatus('error');
      setTestApiKeyMessage('Enter a DeepL API Key first.');
      return;
    }
    setTestApiKeyMessage('');
    setTestApiKeyStatus('idle');
    setIsTestingApiKey(true);
    try {
      const result = await testDeepLApiKey(deeplApiKey, deeplUseFree);
      setTestApiKeyStatus(result.status);
      setTestApiKeyMessage(result.message);
    } catch (err) {
      setTestApiKeyStatus('error');
      setTestApiKeyMessage(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while testing the API key.',
      );
    } finally {
      setIsTestingApiKey(false);
    }
  };

  return (
    <>
      {/* DeepL API Key */}
      <div className={s.fieldSpacing}>
        <TextField
          required
          name="deeplApiKey"
          id="deeplApiKey"
          label="DeepL API Key"
          value={deeplApiKey}
          onChange={handleApiKeyChange}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
          error={testApiKeyStatus === 'error' ? testApiKeyMessage : undefined}
        />
        <div className={`${s.switchField} ${s.buttonRow}`}>
          <Button
            buttonType="muted"
            disabled={isTestingApiKey}
            onClick={handleTestApiKey}
          >
            {isTestingApiKey ? 'Testing…' : 'Test API Key'}
          </Button>
        </div>
        {testApiKeyStatus === 'success' && testApiKeyMessage && (
          <div className={s.inlineStatus} style={{ color: '#237804' }}>
            {testApiKeyMessage}
          </div>
        )}
      </div>

      {/* DeepL Endpoint toggle + Formality */}
      <div className={s.switchField}>
        <SwitchField
          name="deeplUseFree"
          id="deeplUseFree"
          label="Use DeepL Free endpoint (api-free.deepl.com)"
          hint={
            autoToggledFree
              ? "We toggled this on automatically for you because it looks like you're using a free key ending in :fx"
              : "You must use this if you're on the DeepL free plan"
          }
          value={deeplUseFree}
          onChange={(val) => setDeeplUseFree(val)}
        />
      </div>

      <div className={s.fieldSpacing}>
        <label className={s.label} htmlFor="deeplFormality">
          Formality
        </label>
        <SelectField
          name="deeplFormality"
          id="deeplFormality"
          label=""
          value={{ label: deeplFormality, value: deeplFormality }}
          selectInputProps={{
            options: [
              { label: 'default', value: 'default' },
              { label: 'more', value: 'more' },
              { label: 'less', value: 'less' },
            ],
          }}
          onChange={(nv) => {
            if (!Array.isArray(nv)) {
              const selected = nv as {
                value: 'default' | 'more' | 'less';
              } | null;
              if (selected?.value) setDeeplFormality(selected.value);
            }
          }}
        />
      </div>

      <Section title="Tag Settings"  collapsible={{isOpen: showTags, onToggle: () => setShowTags((v) => !v)}}>
        {/* Preserve formatting */}
        <div className={s.switchField}>
          <SwitchField
              name="deeplPreserveFormatting"
              id="deeplPreserveFormatting"
              label="Preserve formatting"
              value={deeplPreserveFormatting}
              onChange={setDeeplPreserveFormatting}
          />
        </div>

        {/* Advanced tags */}
        <div className={s.fieldSpacing}>
          <TextField
              name="deeplIgnoreTags"
              id="deeplIgnoreTags"
              label="Ignore tags (CSV)"
              value={deeplIgnoreTags}
              onChange={setDeeplIgnoreTags}
          />
        </div>
        <div className={s.fieldSpacing}>
          <TextField
              name="deeplNonSplittingTags"
              id="deeplNonSplittingTags"
              label="Non-splitting tags (CSV)"
              value={deeplNonSplittingTags}
              onChange={setDeeplNonSplittingTags}
          />
        </div>
        <div className={s.fieldSpacing}>
          <TextField
              name="deeplSplittingTags"
              id="deeplSplittingTags"
              label="Splitting tags (CSV)"
              value={deeplSplittingTags}
              onChange={setDeeplSplittingTags}
          />
        </div>
      </Section>


      <Section title="Glossary Settings"  collapsible={{isOpen: showGlossary, onToggle: () => setShowGlossary((v) => !v)}}>
        {/* Glossary settings */}
        <div className={s.fieldSpacing}>
          <SelectField
            name="deeplGlossaryId"
            id="deeplGlossaryId"
            label="Default glossary"
            hint="Applied to all translations unless overridden by a language pair mapping below"
            placeholder={
              fetchStatus === 'loading'
                ? 'Loading glossaries...'
                : 'None (no default glossary)'
            }
            value={defaultGlossaryValue}
            error={defaultGlossaryError}
            selectInputProps={{
              options: glossaryOptions,
              isClearable: true,
              isLoading: fetchStatus === 'loading',
            }}
            onChange={(nv) => {
              if (!Array.isArray(nv)) {
                const sel = nv as SelectOption | null;
                setDeeplGlossaryId(sel?.value ?? '');
              }
            }}
          />
          {fetchStatus === 'error' && fetchError && (
            <div
              className={s.inlineStatus}
              style={{ color: '#cf1322', marginTop: 4 }}
            >
              {fetchError}
            </div>
          )}
        </div>

        <div className={s.fieldSpacing}>
          <GlossaryPairEditor
            value={deeplGlossaryPairs}
            onChange={setDeeplGlossaryPairs}
            siteLocales={siteLocales}
            glossaries={glossaries}
            fetchStatus={fetchStatus}
            fetchError={fetchError}
            openConfirm={openConfirm}
          />
        </div>
      </Section>
    </>
  );
}
