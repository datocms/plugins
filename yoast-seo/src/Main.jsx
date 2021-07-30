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
    process.env.NODE_ENV === 'production' ? '/dist/worker.js' : '/worker.js',
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
      console.log(`[Yoast Plugin Error]: ${e}`);
    }
  }, []);

  const refetchPage = useCallback(async () => {
    try {
      setPageFetchingInProgress(true);

      const url = new URL(htmlGeneratorUrl);
      url.searchParams.set('itemId', itemId);
      url.searchParams.set('itemTypeId', itemType.id);
      url.searchParams.set('itemTypeApiKey', itemType.attributes.api_key);
      url.searchParams.set('environmentId', environmentId);
      url.searchParams.set('locale', locale);

      const request = await fetch(url.toString());
      const response = await request.json();

      setPage(response);
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

  useEffect(async () => {
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

      console.log(relatedResults);

      const deserializedResult = {
        readability: removeResultsWithNoText(analyzeResult.readability),
        seo: removeResultsWithNoText(analyzeResult.seo['']),
        relatedKeywordsSeo: relatedKeywords.map((related, i) =>
          removeResultsWithNoText(relatedResults.seo[i]),
        ),
      };

      console.log(deserializedResult);

      setAnalysis(deserializedResult);
    } catch (e) {
      console.log(e);
      throw e;
    } finally {
      setAnalysisInProgress(false);
    }
  }, [
    isWorkerReady,
    JSON.stringify(page),
    keyword,
    synonyms,
    JSON.stringify(relatedKeywords),
  ]);

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
              <ScoreIcon score={analysis ? analysis[tab.key].score / 10 : 0} />
              {tab.key === 'seo' &&
                relatedKeywords
                  .filter((related) => related.keyword)
                  .map((relatedKeyword, i) => (
                    <ScoreIcon
                      score={
                        analysis &&
                        analysis.relatedKeywordsSeo &&
                        analysis.relatedKeywordsSeo[i]
                          ? analysis.relatedKeywordsSeo[i].score / 10
                          : 0
                      }
                    />
                  ))}
            </button>
          ))}
        </div>
        <div className="Plugin__bar__status">
          {!isWorkerReady ? (
            <p>Loading Yoast...</p>
          ) : pageFetchingInProgress ? (
            <p>Extracting content...</p>
          ) : (
            analysisInProgress && <p>Analyzing content...</p>
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
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              strokeWidth="6"
              stroke="currentColor"
              fill="none"
            >
              <path d="M53.72 36.61a21.91 21.91 0 11-3.35-16.51M51.72 7.85l-.87 12.93-12.93-.88M53.72 36.61a21.91 21.91 0 11-3.35-16.51" />
              <path d="M51.72 7.85l-.87 12.93-12.93-.88" />
            </svg>
            Reload content
          </button>
        </div>
      </div>
      <div className="Plugin__content">
        {activeTab === 'seo' ? (
          <>
            <Seo
              key={keyword}
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

            <button
              className="DatoCMS-button DatoCMS-button--expand"
              onClick={() => {
                setRelatedKeywords((old) => [
                  ...old,
                  { keyword: '', synonyms: '' },
                ]);
              }}
            >
              Add related keyphrase
            </button>
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
