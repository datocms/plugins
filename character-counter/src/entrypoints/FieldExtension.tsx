import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import {
  Button,
  Canvas,
  CaretDownIcon,
  CaretUpIcon,
  SwitchInput,
} from 'datocms-react-ui';
import { get } from 'lodash-es';
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import {
  type AnalyticsFieldType,
  analyzeFieldValue,
  summarizeWordFrequencies,
  supportsStopwordFiltering,
} from '../lib/analyzeText';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

type ToggleRowProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

const DETAILED_FIELD_TYPES = new Set<AnalyticsFieldType>([
  'string',
  'text',
  'structured_text',
]);

function formatMetric(value: number): string {
  return value.toLocaleString();
}

function formatSummaryLabel(label: string, value: number): string {
  if (label === 'special character') {
    return value === 1 ? label : 'special characters';
  }

  if (label === 'sentence') {
    return value === 1 ? label : 'sentences';
  }

  if (label === 'paragraph') {
    return value === 1 ? label : 'paragraphs';
  }

  if (label === 'word') {
    return value === 1 ? label : 'words';
  }

  return value === 1 ? label : `${label}s`;
}

function ToggleRow({ id, label, checked, onChange }: ToggleRowProps) {
  return (
    <div className={s.toggleRow}>
      <SwitchInput
        id={id}
        name={id}
        value={checked}
        aria-labelledby={`${id}-label`}
        onChange={onChange}
      />
      <span id={`${id}-label`} className={s.toggleLabel}>
        {label}
      </span>
    </div>
  );
}

export default function FieldExtension({ ctx }: Props) {
  const fieldType = ctx.field.attributes.field_type as AnalyticsFieldType;
  const rawFieldValue = get(ctx.formValues, ctx.fieldPath);
  const deferredFieldValue = useDeferredValue(rawFieldValue);
  const isDetailedField = DETAILED_FIELD_TYPES.has(fieldType);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [includeSpaces, setIncludeSpaces] = useState(true);
  const [filterStopwords, setFilterStopwords] = useState(false);

  const supportsStopwords = supportsStopwordFiltering(ctx.locale);

  useEffect(() => {
    if (!supportsStopwords && filterStopwords) {
      setFilterStopwords(false);
    }
  }, [filterStopwords, supportsStopwords]);

  const analysis = useMemo(
    () =>
      analyzeFieldValue(deferredFieldValue, fieldType, {
        locale: ctx.locale,
        maxTopWords: detailsOpen ? 10 : 0,
      }),
    [ctx.locale, deferredFieldValue, detailsOpen, fieldType],
  );

  const commonWordsSummary = useMemo(() => {
    if (!isDetailedField || !detailsOpen) {
      return {
        uniqueWords: 0,
        topWords: [],
      };
    }

    if (!supportsStopwords || !filterStopwords) {
      return {
        uniqueWords: analysis.uniqueWords,
        topWords: analysis.topWords,
      };
    }

    return summarizeWordFrequencies(analysis.wordFrequencyEntries, {
      locale: ctx.locale,
      filterStopwords: true,
      maxTopWords: 10,
    });
  }, [
    analysis.topWords,
    analysis.uniqueWords,
    analysis.wordFrequencyEntries,
    ctx.locale,
    detailsOpen,
    filterStopwords,
    isDetailedField,
    supportsStopwords,
  ]);

  const characterCount = includeSpaces
    ? analysis.charactersWithSpaces
    : analysis.charactersWithoutSpaces;

  const includeSpacesId = useId();
  const filterStopwordsId = useId();

  return (
    <Canvas ctx={ctx}>
      <div className={s.wrapper}>
        <div className={s.summaryBar}>
          <div className={s.summaryMetrics}>
            <span className={s.summaryMetric}>
              <span className={s.summaryValue}>
                {formatMetric(characterCount)}
              </span>{' '}
              <span className={s.summaryLabel}>characters</span>
            </span>
            {isDetailedField && (
              <>
                <span className={s.summaryMetric}>
                  <span className={s.summaryDivider}>•</span>
                  <span className={s.summaryValue}>
                    {formatMetric(analysis.words)}
                  </span>{' '}
                  <span className={s.summaryLabel}>
                    {formatSummaryLabel('word', analysis.words)}
                  </span>
                </span>
                <span className={s.summaryMetric}>
                  <span className={s.summaryDivider}>•</span>
                  <span className={s.summaryValue}>
                    {formatMetric(analysis.specialCharacters)}
                  </span>{' '}
                  <span className={s.summaryLabel}>
                    {formatSummaryLabel(
                      'special character',
                      analysis.specialCharacters,
                    )}
                  </span>
                </span>
                <span className={s.summaryMetric}>
                  <span className={s.summaryDivider}>•</span>
                  <span className={s.summaryValue}>
                    {formatMetric(analysis.sentences)}
                  </span>{' '}
                  <span className={s.summaryLabel}>
                    {formatSummaryLabel('sentence', analysis.sentences)}
                  </span>
                </span>
                <span className={s.summaryMetric}>
                  <span className={s.summaryDivider}>•</span>
                  <span className={s.summaryValue}>
                    {formatMetric(analysis.paragraphs)}
                  </span>{' '}
                  <span className={s.summaryLabel}>
                    {formatSummaryLabel('paragraph', analysis.paragraphs)}
                  </span>
                </span>
              </>
            )}
          </div>

          <Button
            buttonSize="xs"
            buttonType="muted"
            onClick={() => setDetailsOpen((open) => !open)}
            rightIcon={
              detailsOpen ? (
                <CaretUpIcon width={10} height={10} />
              ) : (
                <CaretDownIcon width={10} height={10} />
              )
            }
          >
            {detailsOpen ? 'Hide details' : 'Show details'}
          </Button>
        </div>

        {detailsOpen && (
          <div className={s.details}>
            <div className={s.controls}>
              <ToggleRow
                id={includeSpacesId}
                label="Include spaces"
                checked={includeSpaces}
                onChange={setIncludeSpaces}
              />
              {isDetailedField && supportsStopwords && (
                <ToggleRow
                  id={filterStopwordsId}
                  label="Filter stopwords"
                  checked={filterStopwords}
                  onChange={setFilterStopwords}
                />
              )}
            </div>

            {isDetailedField && (
              <section className={s.wordSection}>
                <div className={s.sectionTitle}>
                  Common words ({formatMetric(commonWordsSummary.uniqueWords)})
                </div>

                {commonWordsSummary.topWords.length > 0 ? (
                  <div className={s.wordList} role="list">
                    {commonWordsSummary.topWords.map((word) => (
                      <div
                        className={s.wordRow}
                        role="listitem"
                        key={word.word}
                      >
                        <span className={s.word}>{word.word}</span>
                        <span className={s.wordCount}>
                          {formatMetric(word.count)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={s.emptyState}>No words to display yet.</div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </Canvas>
  );
}
