/**
 * DeepLConfig.tsx
 * Configuration component for DeepL vendor settings.
 */

import { Button, SelectField, SwitchField, TextField } from 'datocms-react-ui';
import { useMemo, useState } from 'react';
import ReactTextareaAutosize from 'react-textarea-autosize';
import { RESPONSE_PREVIEW_MAX_LENGTH } from '../../../utils/constants';
import { normalizeProviderError } from '../../../utils/translation/ProviderErrors';
import DeepLProvider from '../../../utils/translation/providers/DeepLProvider';
import s from '../../styles.module.css';

/**
 * Validates a glossary pair line and returns an error message if invalid.
 * Valid formats:
 * - SOURCE->TARGET=GLOSSARY_ID (e.g., EN->DE=gls-abc123)
 * - SOURCE→TARGET=GLOSSARY_ID (unicode arrow)
 * - *->TARGET=GLOSSARY_ID (wildcard source)
 * - SOURCE->*=GLOSSARY_ID (wildcard target)
 *
 * @param line - A single line from the glossary pairs textarea
 * @returns Error message if invalid, null if valid or empty
 */
function validateGlossaryPairLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null; // Empty lines are OK

  // Normalize arrow variants
  const normalized = trimmed.replace(/[→⇒–—]/g, '->').replace(/\s+/g, '');

  // Pattern: SOURCE->TARGET=GLOSSARY_ID or SOURCE->TARGET:GLOSSARY_ID
  const pattern =
    /^([a-zA-Z*]{1,5}(?:-[a-zA-Z]{2,4})?)->([a-zA-Z*]{1,5}(?:-[a-zA-Z]{2,4})?)(?:=|:)((?:gls-)?[A-Za-z0-9_-]+)$/;

  if (!pattern.test(normalized)) {
    return `Invalid format: "${trimmed}". Expected: SOURCE->TARGET=gls-ID (e.g., EN->DE=gls-abc123)`;
  }

  return null;
}

/**
 * Validates all glossary pair lines and returns validation result.
 *
 * @param text - The full textarea content with multiple lines
 * @returns Object with isValid boolean and array of error messages
 */
function validateGlossaryPairs(text: string): {
  isValid: boolean;
  errors: string[];
} {
  if (!text.trim()) {
    return { isValid: true, errors: [] };
  }

  const lines = text.split(/[;\n,]/).filter((l) => l.trim());
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const error = validateGlossaryPairLine(lines[i]);
    if (error) {
      errors.push(`Line ${i + 1}: ${error}`);
    }
  }

  return { isValid: errors.length === 0, errors };
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
}: DeepLConfigProps) {
  const [showDeeplAdvanced, setShowDeeplAdvanced] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [testApiKeyMessage, setTestApiKeyMessage] = useState('');
  const [testApiKeyStatus, setTestApiKeyStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');

  // Validate glossary pairs in real-time
  const glossaryValidation = useMemo(
    () => validateGlossaryPairs(deeplGlossaryPairs),
    [deeplGlossaryPairs],
  );

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
      const base = deeplUseFree
        ? 'https://api-free.deepl.com'
        : 'https://api.deepl.com';
      const provider = new DeepLProvider({
        apiKey: deeplApiKey,
        baseUrl: base,
      });
      const out = await provider.translateArray(['Hello world'], {
        targetLang: 'DE',
      });
      const sample = (out?.[0] ?? '').toString();
      if (sample) {
        setTestApiKeyStatus('success');
        setTestApiKeyMessage(
          `API Key OK. DeepL responded: ${sample.slice(0, RESPONSE_PREVIEW_MAX_LENGTH)}${sample.length > RESPONSE_PREVIEW_MAX_LENGTH ? '…' : ''}`,
        );
      } else {
        setTestApiKeyStatus('success');
        setTestApiKeyMessage('API Key OK. DeepL responded (empty body).');
      }
    } catch (err) {
      const norm = normalizeProviderError(err, 'deepl');
      setTestApiKeyStatus('error');
      setTestApiKeyMessage(norm.message + (norm.hint ? ` — ${norm.hint}` : ''));
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
          onChange={setDeeplApiKey}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
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
        {testApiKeyMessage && (
          <div
            className={s.inlineStatus}
            style={{
              color:
                testApiKeyStatus === 'success'
                  ? '#237804'
                  : testApiKeyStatus === 'error'
                    ? '#cf1322'
                    : undefined,
            }}
          >
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

      {/* Advanced settings toggle */}
      <div className={s.switchField}>
        <Button
          buttonType="muted"
          onClick={() => setShowDeeplAdvanced((v) => !v)}
        >
          {showDeeplAdvanced
            ? 'Hide advanced settings'
            : 'Show advanced settings'}
        </Button>
      </div>

      {showDeeplAdvanced && (
        <div style={{ marginTop: 8 }}>
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

          {/* Glossary settings */}
          <div className={s.fieldSpacing}>
            <label
              className={s.label}
              htmlFor="deeplGlossaryId"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              Default glossary ID
              <div className={s.tooltipContainer}>
                ⓘ
                <div className={`${s.tooltipText} ${s.leftAnchorTooltip}`}>
                  Optional DeepL glossary ID (e.g., gls-abc123) applied when
                  translating with DeepL. You can override per language pair via
                  the mapping below.
                </div>
              </div>
            </label>
            <TextField
              name="deeplGlossaryId"
              id="deeplGlossaryId"
              label=""
              value={deeplGlossaryId}
              onChange={setDeeplGlossaryId}
              placeholder="gls-..."
            />
          </div>

          <div className={s.fieldSpacing}>
            <label
              className={s.label}
              htmlFor="deeplGlossaryPairs"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              Glossaries by language pair
              <div className={s.tooltipContainer}>
                ⓘ
                <div className={`${s.tooltipText} ${s.leftAnchorTooltip}`}>
                  One per line. Use either Dato locales or DeepL codes. Supports
                  wildcards, e.g. *-&gt;pt-BR=gls-123 (any source to pt-BR).
                  Examples: EN-&gt;DE=gls-abc123, en-US-&gt;pt-BR: gls-xyz789,
                  *-&gt;de=gls-777
                </div>
              </div>
            </label>
            <ReactTextareaAutosize
              className={s.textarea}
              id="deeplGlossaryPairs"
              value={deeplGlossaryPairs}
              onChange={(e) => setDeeplGlossaryPairs(e.target.value)}
              minRows={2}
              placeholder={'EN->DE=gls-...\nen-US->pt-BR=gls-...'}
              style={{
                borderColor: !glossaryValidation.isValid
                  ? '#cf1322'
                  : undefined,
              }}
            />
            {!glossaryValidation.isValid && (
              <div
                className={s.inlineStatus}
                style={{ color: '#cf1322', marginTop: 4 }}
              >
                {glossaryValidation.errors.slice(0, 3).map((err) => (
                  <div key={err}>{err}</div>
                ))}
                {glossaryValidation.errors.length > 3 && (
                  <div>
                    ...and {glossaryValidation.errors.length - 3} more error(s)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
