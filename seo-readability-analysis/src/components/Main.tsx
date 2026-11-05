import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Spinner from 'datocms-react-ui/Spinner';
import { Tabs } from 'datocms-react-ui/Tabs';
import get from 'lodash-es/get';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as helpers from 'yoastseo/build/helpers';
import Paper from 'yoastseo/build/values/Paper';
import AnalysisWorkerWrapper from 'yoastseo/build/worker/AnalysisWorkerWrapper';
import createWorker from 'yoastseo/build/worker/createWorker';
import { RefreshIcon } from '../icons';
import type {
  Analysis,
  AnalysisAssessment,
  CustomHeader,
  ValidParameters,
} from '../types';
import Results from './Results';
import Seo from './Seo';
import s from './styles.module.css';

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

const buildCustomHeaders = (
  serializedCustomHeaders: string | undefined,
): Headers => {
  const headers = new Headers();

  if (!serializedCustomHeaders) {
    return headers;
  }

  for (const { name, value } of JSON.parse(
    serializedCustomHeaders,
  ) as CustomHeader[]) {
    headers.set(name, value);
  }

  return headers;
};

const serializeFieldValue = (
  value: Partial<FieldValue> | null | undefined,
): string => JSON.stringify(normalizeFieldValue(value));

const Main = ({ ctx }: PropTypes) => {
  const { htmlGeneratorUrl, customHeaders } = ctx.plugin.attributes
    .parameters as ValidParameters;

  const serializedCustomHeaders = JSON.stringify(customHeaders);

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

      const request = await fetch(url.toString(), {
        headers: buildCustomHeaders(serializedCustomHeaders),
      });

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
    serializedCustomHeaders,
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
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the analysis flow stays as it was, in one place.
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

  const [activeTab, setActiveTab] = useState('seo');
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
  }, [keyword, synonyms, relatedKeywords, comparableRawFieldValue]);

  // The page loads or its first analysis runs
  const firstAnalysisPending =
    !workerError && !analysisError && (pageFetchingInProgress || page !== null);

  return (
    <Tabs
      ariaLabel="Analysis"
      activeTabId={activeTab}
      onChange={setActiveTab}
      extraInfo={
        <div className={s.status}>
          {!workerError && !isWorkerReady && (
            <span className={s.statusText}>
              <Spinner inline label={false} /> Loading the analyzer
            </span>
          )}
          {analysisInProgress && (
            <span className={s.statusText}>
              <Spinner inline label={false} /> Analyzing the content
            </span>
          )}
          <Button
            tone="ghost"
            icon={RefreshIcon}
            label="Reload content"
            onClick={refetchPage}
            busy={pageFetchingInProgress}
          />
        </div>
      }
      beforeContent={
        workerError ? (
          <Callout tone="danger">
            The analyzer couldn't load. The browser console has the details.
          </Callout>
        ) : (
          (pageError || analysisError) && (
            <Callout tone="danger">
              The analysis failed. The browser console has the details.
            </Callout>
          )
        )
      }
      tabs={[
        {
          id: 'seo',
          label: 'SEO',
          content: (
            <Seo
              keyword={keyword}
              synonyms={synonyms}
              setKeyword={setKeyword}
              setSynonyms={setSynonyms}
              relatedKeywords={relatedKeywords}
              setRelatedKeywords={setRelatedKeywords}
              analysis={analysis}
            />
          ),
        },
        {
          id: 'readability',
          label: 'Readability',
          content: analysis ? (
            <Results assessment={analysis.readability} />
          ) : firstAnalysisPending ? (
            <BlankSlate
              placement="inline"
              small
              loading
              title="Loading the analysis"
            />
          ) : (
            <BlankSlate
              placement="inline"
              small
              title="No analysis yet"
              description="The analysis runs on the frontend page of the saved record."
            />
          ),
        },
      ]}
    />
  );
};

export default Main;
