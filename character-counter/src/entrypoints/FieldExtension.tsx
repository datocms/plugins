import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import InfoList from 'datocms-react-ui/InfoList';
import RawButton from 'datocms-react-ui/RawButton';
import SwitchInput from 'datocms-react-ui/SwitchInput';
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

const DETAILED_FIELD_TYPES = new Set<AnalyticsFieldType>([
  'string',
  'text',
  'structured_text',
]);

/** A count, with the separators of the language of the user */
function formatMetric(value: number, locale: string): string {
  return value.toLocaleString(locale);
}

/**
 * A count and its noun. The text is in a RawButton, which takes no `{ id }`
 * message, so the English plural is written here.
 */
function Metric({
  value,
  noun,
  locale,
}: {
  value: number;
  noun: string;
  locale: string;
}) {
  return (
    <span>
      <span className={s.value}>{formatMetric(value, locale)}</span>{' '}
      {value === 1 ? noun : `${noun}s`}
    </span>
  );
}

export default function FieldExtension({ ctx }: Props) {
  const fieldType = ctx.field.attributes.field_type as AnalyticsFieldType;
  const rawFieldValue = get(ctx.formValues, ctx.fieldPath);
  const deferredFieldValue = useDeferredValue(rawFieldValue);
  const isDetailedField = DETAILED_FIELD_TYPES.has(fieldType);
  const detailsId = useId();

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

  const locale = ctx.ui.locale;
  const characterCount = includeSpaces
    ? analysis.charactersWithSpaces
    : analysis.charactersWithoutSpaces;

  return (
    <Canvas ctx={ctx}>
      <RawButton
        className={s.summary}
        expandable={{ open: detailsOpen, controls: detailsId }}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <DisclosureChevron open={detailsOpen} />
        <span className={s.metrics}>
          <Metric value={characterCount} noun="character" locale={locale} />
          {isDetailedField && (
            <>
              <Metric value={analysis.words} noun="word" locale={locale} />
              <Metric
                value={analysis.specialCharacters}
                noun="special character"
                locale={locale}
              />
              <Metric
                value={analysis.sentences}
                noun="sentence"
                locale={locale}
              />
              <Metric
                value={analysis.paragraphs}
                noun="paragraph"
                locale={locale}
              />
            </>
          )}
        </span>
      </RawButton>

      {detailsOpen && (
        <div id={detailsId} className={s.details}>
          <div className={s.switches}>
            <SwitchInput
              label="Include spaces"
              value={includeSpaces}
              onChange={(value) => setIncludeSpaces(!!value)}
            />
            {isDetailedField && supportsStopwords && (
              <SwitchInput
                label="Filter stopwords"
                value={filterStopwords}
                onChange={(value) => setFilterStopwords(!!value)}
              />
            )}
          </div>

          {isDetailedField &&
            (commonWordsSummary.topWords.length > 0 ? (
              <InfoList>
                <InfoList.Row title="Unique words">
                  {formatMetric(commonWordsSummary.uniqueWords, locale)}
                </InfoList.Row>
                <InfoList.Group title="Most common words">
                  {commonWordsSummary.topWords.map((word) => (
                    <InfoList.Row key={word.word} title={word.word}>
                      {formatMetric(word.count, locale)}
                    </InfoList.Row>
                  ))}
                </InfoList.Group>
              </InfoList>
            ) : filterStopwords && analysis.words > 0 ? (
              <BlankSlate
                placement="section"
                small
                title="Every word is a stopword"
              />
            ) : (
              <BlankSlate
                placement="section"
                small
                title="No words yet"
                description="The most common words show here as you type."
              />
            ))}
        </div>
      )}
    </Canvas>
  );
}
