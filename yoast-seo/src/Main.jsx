import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { AnalysisWorkerWrapper, createWorker, Paper, helpers } from 'yoastseo';
import Results from './components/Results';
import KeyphraseInput from './components/KeyphraseInput';
import ScoreIcon from './components/ScoreIcon';
import './style.sass';

const worker = new AnalysisWorkerWrapper(
  createWorker(
    process.env.NODE_ENV === 'production' ? '/dist/worker.js' : '/worker.js',
  ),
);

const removeResultsWithNoText = (data) => {
  return {
    ...data,
    results: data.results.filter(
      (result) => result.text && result.text.length > 0,
    ),
  };
};

const tabs = [
  { title: 'SEO', key: 'seo' },
  { title: 'Readability', key: 'readability' },
];

const Main = ({ fieldValue, htmlGeneratorUrl, itemId }) => {
  const [isWorkerReady, setIsWorkerReady] = React.useState(false);
  const [page, setPage] = React.useState(null);

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

  useEffect(async () => {
    const url = new URL(htmlGeneratorUrl);
    url.searchParams.set('itemId', itemId);

    const request = await fetch(url.toString());
    const response = await request.json();

    setPage(response);
  }, []);

  const [analysisInProgress, setAnalysisInProgress] = React.useState(false);
  const [analysis, setAnalysis] = React.useState(null);

  useEffect(async () => {
    if (!isWorkerReady || !page) {
      return;
    }

    setAnalysisInProgress(true);

    const paper = new Paper(page.content, {
      locale: page.locale,
      keyword: fieldValue ? fieldValue.keyword : 'workflows',
      title: page.title,
      titleWidth: helpers.measureTextWidth(page.title),
      url: page.slug,
      description: page.description,
    });

    const { result } = await worker.analyze(paper);

    setAnalysisInProgress(false);

    console.log(result);

    setAnalysis({
      readability: result && removeResultsWithNoText(result.readability),
      seo: result && removeResultsWithNoText(result.seo['']),
    });
  }, [isWorkerReady, JSON.stringify(page)]);

  const [activeTab, setActiveTab] = React.useState(tabs[0].key);

  return (
    <div className="yoast-seo">
      {isWorkerReady ? (
        analysis ? (
          <div className="yoast-seo__tabs">
            <ul className="yoast-seo__tabs-header">
              {tabs.map((tab) => (
                <li key={tab.key}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`DatoCMS-button ${
                      tab.key === activeTab ? 'active' : ''
                    }`}
                  >
                    {analysis[tab.key] ? (
                      <ScoreIcon score={analysis[tab.key].score / 10} />
                    ) : null}{' '}
                    {tab.title}
                  </button>
                </li>
              ))}
            </ul>
            <div className="yoast-seo__tabs-panel">
              {activeTab === 'seo' ? (
                <>
                  <KeyphraseInput
                    onChange={(value) => onInputChange('focusKeyphrase', value)}
                    onFormSubmit={() => {}}
                    isFormSubmitting={analysisInProgress}
                    initialValue={'workflows'}
                  />
                  {analysis.seo ? <Results assessment={analysis.seo} /> : null}
                </>
              ) : (
                <div className="yoast-seo__readability-tab">
                  <button
                    type="button"
                    className="DatoCMS-button--micro yoast-seo__readability-refresh-btn"
                    onClick={() => {}}
                    disabled={analysisInProgress}
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
                    {analysisInProgress ? 'Refreshing...' : 'Refresh Results'}
                  </button>

                  {analysis.readability ? (
                    <Results assessment={analysis.readability} />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p>Analyzing content...</p>
        )
      ) : (
        <p>Loading Yoast...</p>
      )}
    </div>
  );
};

Main.propTypes = {
  fieldValue: PropTypes.object,
  htmlGeneratorUrl: PropTypes.string.isRequired,
  itemId: PropTypes.string,
};

export default Main;
