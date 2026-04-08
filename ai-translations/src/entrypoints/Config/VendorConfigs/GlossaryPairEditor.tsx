/**
 * GlossaryPairEditor.tsx
 * Structured editor for DeepL glossary-by-language-pair mappings.
 * Replaces the free-text textarea with validated dropdowns.
 */

import { Button, SelectField } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiTypes } from '@datocms/cma-client-browser';
import s from '../../styles.module.css';
import type {
  DeepLGlossary,
  GlossaryFetchStatus,
} from './useDeepLGlossaries';

/** A single row in the editor. */
export interface GlossaryPairRow {
  source: string; // locale code or '*'
  target: string; // locale code or '*'
  glossaryId: string;
}

type SelectOption = { label: string; value: string };

// ── Serialization helpers ──────────────────────────────────────────────

/** Parse the persisted `deeplGlossaryPairs` string into structured rows. */
function parseRows(raw: string): GlossaryPairRow[] {
  if (!raw.trim()) return [];
  const lines = raw
    .split(/\r?\n|[;,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: GlossaryPairRow[] = [];
  for (const line of lines) {
    const normalized = line.replace(/[→⇒–—]/g, '->').replace(/\s+/g, '');
    const m = normalized.match(
      /^([a-zA-Z*]{1,5}(?:-[a-zA-Z]{2,4})?)->([a-zA-Z*]{1,5}(?:-[a-zA-Z]{2,4})?)(?:=|:)([\w-]+)$/,
    );
    if (m) {
      rows.push({ source: m[1], target: m[2], glossaryId: m[3] });
    }
  }
  return rows;
}

/** Serialize structured rows back to the persisted string format. */
function serializeRows(rows: GlossaryPairRow[]): string {
  return rows
    .filter((r) => r.source && r.target && r.glossaryId)
    .map((r) => `${r.source}->${r.target}=${r.glossaryId}`)
    .join('\n');
}

// ── Props ──────────────────────────────────────────────────────────────

export interface GlossaryPairEditorProps {
  value: string;
  onChange: (value: string) => void;
  siteLocales: ApiTypes.Site['locales'];
  glossaries: DeepLGlossary[];
  fetchStatus: GlossaryFetchStatus;
  fetchError: string;
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

// ── Component ──────────────────────────────────────────────────────────

export default function GlossaryPairEditor({
  value,
  onChange,
  siteLocales,
  glossaries,
  fetchStatus,
  fetchError,
  openConfirm,
}: GlossaryPairEditorProps) {
  const [rows, setRows] = useState<GlossaryPairRow[]>(() => parseRows(value));

  // Re-parse rows when the external value changes (e.g. reset / load)
  const externalValue = useRef(value);
  useEffect(() => {
    if (value !== externalValue.current) {
      externalValue.current = value;
      setRows(parseRows(value));
    }
  }, [value]);

  // Propagate row changes upstream
  const commitRows = useCallback(
    (nextRows: GlossaryPairRow[]) => {
      setRows(nextRows);
      const serialized = serializeRows(nextRows);
      externalValue.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  // ── Option builders ────────────────────────────────────────────────

  const localeOptions: SelectOption[] = useMemo(
    () => [
      { label: 'All (*)', value: '*' },
      ...siteLocales.map((l) => ({ label: l, value: l })),
    ],
    [siteLocales],
  );

  const glossaryOptions: SelectOption[] = useMemo(
    () =>
      glossaries.map((g) => ({
        label: `${g.name} (${g.source_lang}\u2192${g.target_lang}, ${g.entry_count} entries)`,
        value: g.glossary_id,
      })),
    [glossaries],
  );

  const validGlossaryIds = useMemo(
    () => new Set(glossaries.map((g) => g.glossary_id)),
    [glossaries],
  );

  const validLocales = useMemo(() => new Set(siteLocales), [siteLocales]);

  // ── Per-row validation ─────────────────────────────────────────────

  function getLocaleError(code: string): string | undefined {
    if (!code || code === '*') return undefined;
    if (siteLocales.length > 0 && !validLocales.has(code)) {
      return `"${code}" is not a locale in this project`;
    }
    return undefined;
  }

  function getGlossaryError(glossaryId: string): string | undefined {
    if (!glossaryId) return undefined;
    if (fetchStatus === 'success' && !validGlossaryIds.has(glossaryId)) {
      return `"${glossaryId}" is not a valid glossary in your DeepL account`;
    }
    return undefined;
  }

  // ── Row CRUD ───────────────────────────────────────────────────────

  const updateRow = (index: number, patch: Partial<GlossaryPairRow>) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    commitRows(next);
  };

  const removeRow = (index: number) => {
    commitRows(rows.filter((_, i) => i !== index));
  };

  const confirmRemoveRow = async (index: number) => {
    const row = rows[index];
    const hasContent = row.source || row.target || row.glossaryId;
    if (!hasContent) {
      removeRow(index);
      return;
    }
    const from = row.source || '?';
    const to = row.target || '?';
    const glossaryMatch = glossaries.find(
      (g) => g.glossary_id === row.glossaryId,
    );
    const glossaryLabel = glossaryMatch
      ? glossaryMatch.name
      : row.glossaryId || '?';
    const confirmed = await openConfirm({
      title: 'Remove glossary?',
      content: `Are you sure you wish to remove the glossary from ${from} to ${to} using the glossary "${glossaryLabel}"?`,
      choices: [{ label: 'Remove', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });
    if (confirmed) {
      removeRow(index);
    }
  };

  const addRow = () => {
    commitRows([...rows, { source: '', target: '', glossaryId: '' }]);
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <label
          className={s.label}
          style={{ display: 'flex', alignItems: 'center', margin: 0 }}
        >
          Glossaries by language pair
          <div className={s.tooltipContainer}>
            &#9432;
            <div className={`${s.tooltipText} ${s.leftAnchorTooltip}`}>
              Map specific language pairs to DeepL glossaries. Use &quot;All
              (*)&quot; as a wildcard to match any source or target locale.
            </div>
          </div>
        </label>
      </div>

      {fetchStatus === 'error' && fetchError && (
        <div
          className={s.inlineStatus}
          style={{ color: '#cf1322', marginBottom: 8 }}
        >
          {fetchError}
        </div>
      )}

      {rows.map((row, i) => {
        const sourceError = getLocaleError(row.source);
        const targetError = getLocaleError(row.target);
        const glossaryError = getGlossaryError(row.glossaryId);

        const glossaryValue = row.glossaryId
          ? glossaryOptions.find((o) => o.value === row.glossaryId) ?? {
              label: row.glossaryId,
              value: row.glossaryId,
            }
          : null;

        const sourceValue = row.source
          ? localeOptions.find((o) => o.value === row.source) ?? {
              label: row.source,
              value: row.source,
            }
          : null;

        const targetValue = row.target
          ? localeOptions.find((o) => o.value === row.target) ?? {
              label: row.target,
              value: row.target,
            }
          : null;

        return (
          <div
            key={`glossary-row-${i}`}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'start',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                border: '1px solid var(--border-color, #e0e0e0)',
                borderRadius: 4,
                padding: '10px 12px',
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SelectField
                    id={`glossarySource-${i}`}
                    name={`glossarySource-${i}`}
                    label="From"
                    placeholder="Source"
                    value={sourceValue}
                    error={sourceError}
                    selectInputProps={{ options: localeOptions }}
                    onChange={(nv) => {
                      if (!Array.isArray(nv)) {
                        const sel = nv as SelectOption | null;
                        updateRow(i, { source: sel?.value ?? '' });
                      }
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SelectField
                    id={`glossaryTarget-${i}`}
                    name={`glossaryTarget-${i}`}
                    label="To"
                    placeholder="Target"
                    value={targetValue}
                    error={targetError}
                    selectInputProps={{ options: localeOptions }}
                    onChange={(nv) => {
                      if (!Array.isArray(nv)) {
                        const sel = nv as SelectOption | null;
                        updateRow(i, { target: sel?.value ?? '' });
                      }
                    }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <SelectField
                  id={`glossaryId-${i}`}
                  name={`glossaryId-${i}`}
                  label="Glossary"
                  placeholder={
                    fetchStatus === 'loading'
                      ? 'Loading glossaries...'
                      : 'Select glossary'
                  }
                  value={glossaryValue}
                  error={glossaryError}
                  selectInputProps={{
                    options: glossaryOptions,
                    isLoading: fetchStatus === 'loading',
                  }}
                  onChange={(nv) => {
                    if (!Array.isArray(nv)) {
                      const sel = nv as SelectOption | null;
                      updateRow(i, { glossaryId: sel?.value ?? '' });
                    }
                  }}
                />
              </div>
            </div>
            <div style={{ paddingTop: 24, flexShrink: 0 }}>
              <Button
                type="button"
                buttonType="negative"
                buttonSize="xxs"
                onClick={() => confirmRemoveRow(i)}
              >
                &times;
              </Button>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button
          type="button"
          buttonType="muted"
          buttonSize="xs"
          onClick={addRow}
        >
          + Add language pair
        </Button>
      </div>
    </div>
  );
}
