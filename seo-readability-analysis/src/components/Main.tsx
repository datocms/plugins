import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Button } from 'datocms-react-ui';
import get from 'lodash-es/get';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as helpers from 'yoastseo/build/helpers';
import Paper from 'yoastseo/build/values/Paper';
import AnalysisWorkerWrapper from 'yoastseo/build/worker/AnalysisWorkerWrapper';
import createWorker from 'yoastseo/build/worker/createWorker';
import type { Analysis, AnalysisAssessment, ValidParameters } from '../types';
import Results from './Results';
import ScoreIcon from './ScoreIcon';
import Seo from './Seo';

const worker = new AnalysisWorkerWrapper(
  createWorker(import.meta.env.PROD ? './main.js' : '/main.js'),
);

const serializeForLog = (value: unknown): string => {
  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(
      value,
      (_key, currentValue: unknown) => {
        if (currentValue instanceof Error) {
          return Object.fromEntries(
            Object.getOwnPropertyNames(currentValue).map((name) => [
              name,
              currentValue[name as keyof Error],
            ]),
          );
        }

        if (typeof currentValue === 'object' && currentValue !== null) {
          if (seen.has(currentValue)) {
            return '[Circular]';
          }

          seen.add(currentValue);
        }

        return currentValue;
      },
      2,
    );

    return serialized ?? String(value);
  } catch {
    return String(value);
  }
};

const logPluginError = (context: string, error: unknown) => {
  console.error(
    `[SEO/Readability Analysis Plugin Error] ${context}: ${serializeForLog(error)}`,
  );
};

const removeResultsWithNoText = (
  data: AnalysisAssessment,
): AnalysisAssessment => {
  return {
    ...data,
    results: data.results.filter((result) => result.text?.length > 0),
  };
};

const tabs = [
  { title: 'SEO', key: 'seo' },
  { title: 'Readability', key: 'readability' },
];

type FieldValue = {
  keyword: string;
  synonyms: string;
  relatedKeywords: Array<{ keyword: string; synonyms: string }>;
};

type Page = {
  content: string;
  locale: string;
  title: string;
  slug: string;
  description: string;
};

type PropTypes = {
  ctx: RenderFieldExtensionCtx;
};

const normalizeFieldValue = (
  value: Partial<FieldValue> | null | undefined,
): FieldValue => ({
  keyword: value?.keyword ?? '',
  synonyms: value?.synonyms ?? '',
  relatedKeywords: Array.isArray(value?.relatedKeywords)
    ? value.relatedKeywords.map((related) => ({
        keyword: related?.keyword ?? '',
        synonyms: related?.synonyms ?? '',
      }))
    : [],
});

const serializeFieldValue = (
  value: Partial<FieldValue> | null | undefined,
): string => JSON.stringify(normalizeFieldValue(value));

const Main = ({ ctx }: PropTypes) => {
  const { htmlGeneratorUrl } = ctx.plugin.attributes
    .parameters as ValidParameters;

  const rawFieldValue = get(ctx.formValues, ctx.fieldPath) as string | null;
  const fieldValue = rawFieldValue
    ? (JSON.parse(rawFieldValue) as FieldValue)
    : null;
  const comparableRawFieldValue = serializeFieldValue(fieldValue);
  const {
    item,
    locale,
    itemType,
    environment: environmentId,
    isSubmitting,
  } = ctx;

  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [pageError, setPageError] = useState<Error | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [pageFetchingInProgress, setPageFetchingInProgress] = useState(false);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const [keyword, setKeyword] = useState(fieldValue?.keyword || '');
  const [synonyms, setSynonyms] = useState(fieldValue?.synonyms || '');
  const [relatedKeywords, setRelatedKeywords] = useState(
    fieldValue?.relatedKeywords || [],
  );

  useEffect(() => {
    const run = async () => {
      try {
        await worker.initialize({
          locale: 'en',
          contentAnalysisActive: true,
          keywordAnalysisActive: true,
        });
        setWorkerError(null);
        setIsWorkerReady(true);
      } catch (e) {
        const serializedError = serializeForLog(e);

        setWorkerError(serializedError);
        logPluginError('Failed to initialize web worker', e);
      }
    };

    run();
  }, []);

  const refetchPage = useCallback(async () => {
    try {
      setPageError(null);
      setPageFetchingInProgress(true);

      if (!htmlGeneratorUrl) {
        throw new Error(`Missing "Frontend metadata endpoint URL" option!`);
      }

      const url = new URL(htmlGeneratorUrl);
      if (item?.id) {
        url.searchParams.set('itemId', item.id);
      }
      url.searchParams.set('itemTypeId', itemType.id);
      url.searchParams.set('itemTypeApiKey', itemType.attributes.api_key);

      if (environmentId) {
        url.searchParams.set('sandboxEnvironmentId', environmentId);
      }

      url.searchParams.set('locale', locale);

      const request = await fetch(url.toString());

      if (request.status !== 200) {
        throw new Error(`Endpoint returned status ${request.status}`);
      }

      let response: Page | null = null;

      try {
        response = await request.json();
      } catch (_e) {
        throw new Error(`Endpoint response is not JSON!`);
      }

      const missingKeys = (
        ['content', 'locale', 'title', 'slug', 'description'] as const
      ).filter((key) => !response?.[key]);

      if (missingKeys.length > 0) {
        throw new Error(`Missing keys in response: ${missingKeys.join(', ')}`);
      }

      setPage(response);
    } catch (e) {
      setPageError(e as Error);
      logPluginError('Failed to fetch frontend metadata', e);
    } finally {
      setPageFetchingInProgress(false);
    }
  }, [
    htmlGeneratorUrl,
    item?.id,
    itemType.id,
    itemType.attributes.api_key,
    environmentId,
    locale,
  ]);

  useEffect(() => {
    if (isSubmitting || !item?.id) {
      return;
    }

    refetchPage();
  }, [refetchPage, item?.id, isSubmitting]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const run = async () => {
        if (!isWorkerReady || !page) {
          return;
        }

        setAnalysisInProgress(true);
        setAnalysisError(null);

        try {
          const paper = new Paper(page.content, {
            locale: page.locale,
            keyword,
            synonyms,
            title: page.title,
            titleWidth: helpers.measureTextWidth(page.title),
            url: page.slug,
            description: page.description,
          });

          const { result: analyzeResult } = await worker.analyze(paper);

          const relatedResults =
            relatedKeywords.length > 0
              ? (
                  await worker.analyzeRelatedKeywords(
                    paper,
                    Object.fromEntries(
                      relatedKeywords.map((related, i) => [i, related]),
                    ),
                  )
                ).result
              : null;

          const deserializedResult = {
            readability: removeResultsWithNoText(analyzeResult.readability),
            seo: removeResultsWithNoText(analyzeResult.seo['']),
            relatedKeywordsSeo: relatedResults
              ? relatedKeywords.map((_, i) =>
                  removeResultsWithNoText(relatedResults.seo[i]),
                )
              : [],
          };

          setAnalysis(deserializedResult);
        } catch (e) {
          setAnalysisError(serializeForLog(e));
          logPluginError('Failed to analyze content', e);
        } finally {
          setAnalysisInProgress(false);
        }
      };

      run();
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [isWorkerReady, page, keyword, synonyms, relatedKeywords]);

  const [activeTab, setActiveTab] = useState(tabs[0].key);
  const hasMounted = useRef(false);
  const ctxRef = useRef(ctx);
  const lastSyncedValue = useRef<string>(comparableRawFieldValue);

  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  useEffect(() => {
    lastSyncedValue.current = comparableRawFieldValue;
  }, [comparableRawFieldValue]);

  useEffect(() => {
    const serializedValue = serializeFieldValue({
      keyword,
      synonyms,
      relatedKeywords,
    });

    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    if (lastSyncedValue.current === serializedValue) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastSyncedValue.current = serializedValue;
      Promise.resolve(
        ctxRef.current.setFieldValue(ctxRef.current.fieldPath, serializedValue),
      ).catch((error) => {
        logPluginError('Field value write failed', error);
      });
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [
    keyword,
    synonyms,
    relatedKeywords,
    comparableRawFieldValue,
  ]);

  const validRelatedIndices = relatedKeywords
    .map((related, i) => ({ related, i }))
    .filter(
      ({ related, i }) =>
        related.keyword &&
        analysis?.relatedKeywordsSeo &&
        i in analysis.relatedKeywordsSeo,
    )
    .map(({ i }) => i);

  const overallSeoScore =
    analysis && keyword
      ? validRelatedIndices.reduce(
          (acc, i) => acc + analysis.relatedKeywordsSeo[i].score / 10,
          analysis.seo.score / 10,
        ) /
        (1.0 + validRelatedIndices.length)
      : 0;

  return (
    <div className="Plugin">
      <div className="Plugin__bar">
        <div className="Plugin__bar__options">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`Plugin__bar__option ${
                tab.key === activeTab ? 'is-active' : ''
              }`}
            >
              {tab.title}{' '}
              <ScoreIcon
                score={
                  tab.key === 'seo'
                    ? overallSeoScore
                    : analysis && analysis.readability.score / 10
                }
              />
            </button>
          ))}
        </div>
        <div className="Plugin__bar__status">
          {workerError ? (
            <p className="Plugin__bar__status-error">
              Error loading web worker! More info on console
            </p>
          ) : !isWorkerReady ? (
            <p>Loading web worker...</p>
          ) : pageFetchingInProgress ? (
            <p>Extracting content...</p>
          ) : analysisInProgress ? (
            <p>Analyzing content...</p>
          ) : (
            (pageError || analysisError) && (
              <p className="Plugin__bar__status-error">
                Error running analysis! More info on console
              </p>
            )
          )}
        </div>
        <div className="Plugin__bar__actions">
          <Button
            type="button"
            buttonSize="xxs"
            onClick={refetchPage}
            disabled={pageFetchingInProgress}
            leftIcon={
              <svg
                aria-hidden="true"
                focusable="false"
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
                style={{ width: '1em', height: '1em' }}
              >
                <path
                  fill="currentColor"
                  d="M440.65 12.57l4 82.77A247.16 247.16 0 0 0 255.83 8C134.73 8 33.91 94.92 12.29 209.82A12 12 0 0 0 24.09 224h49.05a12 12 0 0 0 11.67-9.26 175.91 175.91 0 0 1 317-56.94l-101.46-4.86a12 12 0 0 0-12.57 12v47.41a12 12 0 0 0 12 12H500a12 12 0 0 0 12-12V12a12 12 0 0 0-12-12h-47.37a12 12 0 0 0-11.98 12.57zM255.83 432a175.61 175.61 0 0 1-146-77.8l101.8 4.87a12 12 0 0 0 12.57-12v-47.4a12 12 0 0 0-12-12H12a12 12 0 0 0-12 12V500a12 12 0 0 0 12 12h47.35a12 12 0 0 0 12-12.6l-4.15-82.57A247.17 247.17 0 0 0 255.83 504c121.11 0 221.93-86.92 243.55-201.82a12 12 0 0 0-11.8-14.18h-49.05a12 12 0 0 0-11.67 9.26A175.86 175.86 0 0 1 255.83 432z"
                ></path>
              </svg>
            }
          >
            Reload content
          </Button>
        </div>
      </div>
      <div className="Plugin__content">
        {activeTab === 'seo' ? (
          <>
            <Seo
              keyword={keyword}
              synonyms={synonyms}
              setKeyword={setKeyword}
              setSynonyms={setSynonyms}
              analysis={analysis?.seo}
            />

            {relatedKeywords.map((relatedKeyword, i) => (
              <Seo
                key={relatedKeyword.keyword || `related-keyword-${i}`}
                keyword={relatedKeyword.keyword}
                synonyms={relatedKeyword.synonyms}
                setKeyword={(keyword) =>
                  setRelatedKeywords((old) =>
                    old.map((related, j) =>
                      i === j ? { ...related, keyword } : related,
                    ),
                  )
                }
                setSynonyms={(synonyms) =>
                  setRelatedKeywords((old) =>
                    old.map((related, j) =>
                      i === j ? { ...related, synonyms } : related,
                    ),
                  )
                }
                onRemove={() => {
                  setRelatedKeywords((old) => old.filter((_, j) => i !== j));
                }}
                analysis={analysis?.relatedKeywordsSeo[i]}
              />
            ))}

            {keyword && (
              <div className="Plugin__add-new">
                <Button
                  type="button"
                  fullWidth
                  onClick={() => {
                    setRelatedKeywords((old) => [
                      ...old,
                      { keyword: '', synonyms: '' },
                    ]);
                  }}
                >
                  Add related keyword
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="Plugin__readability">
            <Results assessment={analysis?.readability} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Main;
