import React, { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { AnalysisWorkerWrapper, createWorker, Paper, helpers } from 'yoastseo';
import Results from './components/Results';
import Seo from './components/Seo';
import ScoreIcon from './components/ScoreIcon';
import useDebouncedEffect from 'use-debounced-effect-hook';
import './style.sass';

const worker = new AnalysisWorkerWrapper(
  createWorker(
    process.env.NODE_ENV === 'production' ? './worker.js' : '/worker.js',
  ),
);

const removeResultsWithNoText = (data) => {
  return {
    ...data,
    results: data.results.filter((result) => result.text?.length > 0),
  };
};

const tabs = [
  { title: 'SEO', key: 'seo' },
  { title: 'Readability', key: 'readability' },
];

const Main = ({
  fieldValue,
  htmlGeneratorUrl,
  itemId,
  locale,
  itemType,
  environmentId,
  setFieldValue,
  isSubmitting,
}) => {
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const [page, setPage] = useState(null);
  const [pageError, setPageError] = useState(null);

  const [pageFetchingInProgress, setPageFetchingInProgress] = useState(false);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const [keyword, setKeyword] = useState(fieldValue?.keyword || '');
  const [synonyms, setSynonyms] = useState(fieldValue?.synonyms || '');
  const [relatedKeywords, setRelatedKeywords] = useState(
    fieldValue?.relatedKeywords || [],
  );

  useEffect(async () => {
    try {
      await worker.initialize({
        locale: 'en',
        contentAnalysisActive: true,
        keywordAnalysisActive: true,
      });
      setIsWorkerReady(true);
    } catch (e) {
      console.log(`[SEO/Readability Analysis Plugin Error]: ${e}`);
    }
  }, []);

  const refetchPage = useCallback(async () => {
    try {
      setPageError(null);
      setPageFetchingInProgress(true);

      if (!htmlGeneratorUrl) {
        throw new Error(`Missing "Frontend metadata endpoint URL" option!`);
      }

      const url = new URL(htmlGeneratorUrl);
      url.searchParams.set('itemId', itemId);
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

      let response;

      try {
        response = await request.json();
      } catch (e) {
        throw new Error(`Endpoint response is not JSON!`);
      }

      const missingKeys = [
        'content',
        'locale',
        'title',
        'slug',
        'description',
      ].filter((key) => !response[key]);

      if (missingKeys.length > 0) {
        throw new Error(`Missing keys in response: ${missingKeys.join(', ')}`);
      }

      setPage(response);
    } catch (e) {
      setPageError(e);
      console.error(`SEO/Readability Analysis plugin error!`, e);
    } finally {
      setPageFetchingInProgress(false);
    }
  }, [
    htmlGeneratorUrl,
    itemId,
    itemType.id,
    itemType.attributes.api_key,
    environmentId,
    locale,
    setPage,
    setPageFetchingInProgress,
    setPageError,
  ]);

  useEffect(() => {
    if (isSubmitting || !itemId) {
      return;
    }

    refetchPage();
  }, [
    htmlGeneratorUrl,
    itemId,
    itemType.id,
    itemType.attributes.api_key,
    environmentId,
    locale,
    isSubmitting,
    setPage,
  ]);

  useDebouncedEffect(
    async () => {
      if (!isWorkerReady || !page) {
        return;
      }

      setAnalysisInProgress(true);

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
                  relatedKeywords.reduce(
                    (acc, related, i) => ({
                      ...acc,
                      [i]: related,
                    }),
                    {},
                  ),
                )
              ).result
            : null;

        const deserializedResult = {
          readability: removeResultsWithNoText(analyzeResult.readability),
          seo: removeResultsWithNoText(analyzeResult.seo['']),
          relatedKeywordsSeo: relatedKeywords.map((related, i) =>
            removeResultsWithNoText(relatedResults.seo[i]),
          ),
        };

        setAnalysis(deserializedResult);
      } catch (e) {
        console.error(`SEO/Readability Analysis plugin error!`, e);
        throw e;
      } finally {
        setAnalysisInProgress(false);
      }
    },
    [
      isWorkerReady,
      JSON.stringify(page),
      keyword,
      synonyms,
      JSON.stringify(relatedKeywords),
    ],
    500,
  );

  const [activeTab, setActiveTab] = useState(tabs[0].key);

  useDebouncedEffect(
    () => {
      setFieldValue({
        keyword,
        synonyms,
        relatedKeywords,
      });
    },
    [keyword, synonyms, relatedKeywords],
    200,
  );

  const validRelatedIndices = relatedKeywords
    .map((related, i) => ({ related, i }))
    .filter(
      ({ related, i }) =>
        related.keyword &&
        analysis &&
        analysis.relatedKeywordsSeo &&
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
                    : analysis?.readability.score / 10
                }
              />
            </button>
          ))}
        </div>
        <div className="Plugin__bar__status">
          {!isWorkerReady ? (
            <p>Loading web worker...</p>
          ) : pageFetchingInProgress ? (
            <p>Extracting content...</p>
          ) : analysisInProgress ? (
            <p>Analyzing content...</p>
          ) : (
            pageError && (
              <p className="Plugin__bar__status-error">
                Error fetching data! More info on console
              </p>
            )
          )}
        </div>
        <div className="Plugin__bar__actions">
          <button
            type="button"
            className="DatoCMS-button DatoCMS-button--tiny"
            onClick={refetchPage}
            disabled={pageFetchingInProgress}
          >
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
            <span>Reload content</span>
          </button>
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
                key={i}
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
                  setRelatedKeywords((old) =>
                    old.filter((related, j) => i !== j),
                  );
                }}
                analysis={analysis?.relatedKeywordsSeo[i]}
              />
            ))}

            {keyword && (
              <button
                className="DatoCMS-button DatoCMS-button--expand"
                onClick={() => {
                  setRelatedKeywords((old) => [
                    ...old,
                    { keyword: '', synonyms: '' },
                  ]);
                }}
              >
                Add related keyword
              </button>
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

Main.propTypes = {
  fieldValue: PropTypes.object,
  htmlGeneratorUrl: PropTypes.string.isRequired,
  itemId: PropTypes.string,
  locale: PropTypes.string,
  environmentId: PropTypes.string,
  itemType: PropTypes.object.isRequired,
  setFieldValue: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool.isRequired,
};

export default Main;
