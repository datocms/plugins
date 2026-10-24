/**
 * GlossaryPairEditor.tsx
 * The DeepL glossaries by language pair: a list whose rows each pick a source
 * locale, a target locale and a glossary. The rows are stored in the
 * `deeplGlossaryPairs` parameter, one `src->tgt=glossaryId` line per row.
 */

import type { ApiTypes } from '@datocms/cma-client-browser';
import { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import TableList, {
  type TableListColumn,
  type TableListErrorId,
  type TableListRowErrors,
} from 'datocms-react-ui/TableList';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCount } from '../../../components/BulkTranslations/bulkCopy';
import { formatLocaleWithCode } from '../../../utils/localeUtils';
import {
  GLOSSARY_ERROR_ID,
  GLOSSARY_LOCALE_ERROR_ID,
} from '../../../utils/texts';
import type { DeepLGlossary, GlossaryFetchStatus } from './useDeepLGlossaries';

/** A single row in the editor. */
export interface GlossaryPairRow {
  source: string; // locale code or '*'
  target: string; // locale code or '*'
  glossaryId: string;
}

type SelectOption = { label: string; value: string };

/** The locale value that matches any locale. */
const ANY_LOCALE = '*';
const ANY_LOCALE_LABEL = 'All (*)';

/**
 * One error per kind: the list shows each one once. They are ids of the
 * plugin's texts, not strings: the list builds the DOM id of each message
 * from its error, and a text with spaces would make an id that the cells'
 * `aria-describedby` can't point to.
 */
const LOCALE_ERROR: TableListErrorId = { id: GLOSSARY_LOCALE_ERROR_ID };
const GLOSSARY_ERROR: TableListErrorId = { id: GLOSSARY_ERROR_ID };

const newRow = (): GlossaryPairRow => ({
  source: '',
  target: '',
  glossaryId: '',
});

// ── Serialization helpers ──────────────────────────────────────────────

/** Parse the persisted `deeplGlossaryPairs` string into structured rows. */
export function parseRows(raw: string): GlossaryPairRow[] {
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
export function serializeRows(rows: GlossaryPairRow[]): string {
  return rows
    .filter((r) => r.source && r.target && r.glossaryId)
    .map((r) => `${r.source}->${r.target}=${r.glossaryId}`)
    .join('\n');
}

// ── Options and validation, shared with the default glossary ──────────

/**
 * The option label of a glossary: its name, languages and size, with the
 * separators of `locale` (the user's language, `ctx.ui.locale`).
 */
function glossaryLabel(glossary: DeepLGlossary, locale?: string): string {
  const entries = `${formatCount(glossary.entry_count, locale)} ${glossary.entry_count === 1 ? 'entry' : 'entries'}`;
  return `${glossary.name} (${glossary.source_lang}→${glossary.target_lang}, ${entries})`;
}

/** The select options of the glossaries of the DeepL account. */
export function glossaryOptionsFrom(
  glossaries: DeepLGlossary[],
  locale?: string,
) {
  return glossaries.map((glossary) => ({
    label: glossaryLabel(glossary, locale),
    value: glossary.glossary_id,
  }));
}

/** A saved value that no option has (a locale code, a glossary ID) shows as it is. */
export function rawOption(value: string): SelectOption {
  return { value, label: value };
}

/**
 * The text of an open glossary menu with no option to show: why the list is
 * empty, since the glossaries come from the DeepL account of the key.
 */
export function glossaryNoOptionsMessage(fetchStatus: GlossaryFetchStatus) {
  return ({ inputValue }: { inputValue: string }) => {
    if (fetchStatus === 'idle') {
      return 'Enter the API key to load the glossaries.';
    }
    if (fetchStatus === 'error') return "Couldn't load the glossaries.";
    return inputValue
      ? 'No glossaries found'
      : 'No glossaries in this DeepL account';
  };
}

/**
 * The errors of each row: a locale that the project doesn't have, or a
 * glossary that the DeepL account doesn't have (checked once the list loaded).
 * Empty cells are not errors: an incomplete row is only left out of the save.
 */
export function glossaryPairErrors(
  rows: GlossaryPairRow[],
  siteLocales: string[],
  glossaries: DeepLGlossary[],
  fetchStatus: GlossaryFetchStatus,
): (TableListRowErrors | undefined)[] {
  const locales = new Set(siteLocales);
  const glossaryIds = new Set(glossaries.map((g) => g.glossary_id));

  const localeError = (code: string) =>
    code && code !== ANY_LOCALE && siteLocales.length > 0 && !locales.has(code)
      ? LOCALE_ERROR
      : undefined;
  const glossaryError = (glossaryId: string) =>
    glossaryId && fetchStatus === 'success' && !glossaryIds.has(glossaryId)
      ? GLOSSARY_ERROR
      : undefined;

  return rows.map((row) => {
    const errors = {
      source: localeError(row.source),
      target: localeError(row.target),
      glossaryId: glossaryError(row.glossaryId),
    };
    return errors.source || errors.target || errors.glossaryId
      ? errors
      : undefined;
  });
}

/** The value of a select cell: the string, or null for an empty cell. */
function cellValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

// ── Props ──────────────────────────────────────────────────────────────

export interface GlossaryPairEditorProps {
  value: string;
  onChange: (value: string) => void;
  siteLocales: ApiTypes.Site['locales'];
  glossaries: DeepLGlossary[];
  fetchStatus: GlossaryFetchStatus;
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
  openConfirm,
}: GlossaryPairEditorProps) {
  // Glossary sizes get the separators of the language of the Canvas.
  const uiLocale = useCtx().ui.locale;
  // The rows of the editor, incomplete ones included: only complete rows
  // reach the stored string.
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

  // ── Options ────────────────────────────────────────────────────────

  const localeOptions: SelectOption[] = useMemo(
    () => [
      { label: ANY_LOCALE_LABEL, value: ANY_LOCALE },
      ...siteLocales.map((locale) => ({
        label: formatLocaleWithCode(locale),
        value: locale,
      })),
    ],
    [siteLocales],
  );

  const glossaryOptions = useMemo(
    () => glossaryOptionsFrom(glossaries, uiLocale),
    [glossaries, uiLocale],
  );

  // A cell is narrow: it shows the name of the glossary, and the menu its
  // languages and size too.
  const glossaryNames = useMemo(
    () => new Map(glossaries.map((g) => [g.glossary_id, g.name])),
    [glossaries],
  );

  // The menus of the cells open upward. A focused cell is a layer under the
  // "add" gap at the bottom of the list, which would catch the clicks on the
  // options of the last row that cover it.
  const columns = useMemo<TableListColumn<GlossaryPairRow>[]>(() => {
    const localeColumn = (
      id: 'source' | 'target',
      label: string,
    ): TableListColumn<GlossaryPairRow> => ({
      id,
      field: id,
      label,
      grow: 1,
      // The class of the cell input is for a text input: the select doesn't
      // take it.
      render: ({
        index,
        value: cell,
        onChange: onCellChange,
        onBlur,
        inputProps: { className: _className, ...inputProps },
      }) => (
        <SelectInput
          {...inputProps}
          name={`glossary-${id}-${index}`}
          value={cellValue(cell)}
          onChange={(next) => onCellChange(next ?? '')}
          onBlur={onBlur}
          options={localeOptions}
          acceptValueNotIncludedInOptions={rawOption}
          clearable={false}
          placeholder="Pick a locale"
          variant="embedded"
          classNamePrefix="TableList__select"
          menuPlacement="top"
        />
      ),
    });

    return [
      localeColumn('source', 'From'),
      localeColumn('target', 'To'),
      {
        id: 'glossaryId',
        field: 'glossaryId',
        label: 'Glossary',
        grow: 1,
        render: ({
          index,
          value: cell,
          onChange: onCellChange,
          onBlur,
          inputProps: { className: _className, ...inputProps },
        }) => (
          <SelectInput
            {...inputProps}
            name={`glossary-id-${index}`}
            value={cellValue(cell)}
            onChange={(next) => onCellChange(next ?? '')}
            onBlur={onBlur}
            options={glossaryOptions}
            acceptValueNotIncludedInOptions={rawOption}
            loading={fetchStatus === 'loading'}
            noOptionsMessage={glossaryNoOptionsMessage(fetchStatus)}
            formatOptionLabel={(
              option: SelectOption,
              { context }: { context: 'menu' | 'value' },
            ) =>
              context === 'value'
                ? (glossaryNames.get(option.value) ?? option.label)
                : option.label
            }
            clearable={false}
            placeholder="Pick a glossary"
            variant="embedded"
            classNamePrefix="TableList__select"
            menuPlacement="top"
          />
        ),
      },
    ];
  }, [localeOptions, glossaryOptions, glossaryNames, fetchStatus]);

  const errors = useMemo(
    () => glossaryPairErrors(rows, siteLocales, glossaries, fetchStatus),
    [rows, siteLocales, glossaries, fetchStatus],
  );

  // ── Removal ────────────────────────────────────────────────────────

  const localeName = (code: string) => {
    if (!code) return 'no locale';
    if (code === ANY_LOCALE) return ANY_LOCALE_LABEL;
    return siteLocales.includes(code) ? formatLocaleWithCode(code) : code;
  };

  const confirmRemove = async (row: GlossaryPairRow, remove: () => void) => {
    // An empty row goes at once: there is nothing to lose.
    if (!row.source && !row.target && !row.glossaryId) {
      remove();
      return;
    }
    const glossaryName =
      glossaries.find((g) => g.glossary_id === row.glossaryId)?.name ??
      row.glossaryId;
    const confirmed = await openConfirm({
      title: 'Remove this language pair?',
      content: glossaryName
        ? `From ${localeName(row.source)} to ${localeName(row.target)}, with the glossary “${glossaryName}”.`
        : `From ${localeName(row.source)} to ${localeName(row.target)}, with no glossary.`,
      choices: [{ label: 'Remove', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });
    if (confirmed) remove();
  };

  return (
    <FieldWrapper
      label="Glossaries by language pair"
      hint="Each row picks the glossary for a pair of locales. “All (*)” matches any locale."
    >
      <TableList<GlossaryPairRow>
        value={rows}
        onChange={commitRows}
        columns={columns}
        errors={errors}
        // Errors come from saved values, so they show at once.
        touched={true}
        emptyMessage="No language pairs"
        add={{ label: 'Add language pair', newItem: newRow }}
        onRemove={(_index, row, remove) => {
          confirmRemove(row, remove);
        }}
      />
    </FieldWrapper>
  );
}
