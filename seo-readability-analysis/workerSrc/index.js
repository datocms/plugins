import { AnalysisWebWorker } from 'yoastseo';
import EnglishResearcherModule from 'yoastseo/build/languageProcessing/languages/en/Researcher.js';

const resolveConstructor = (value) => {
  let current = value;

  while (
    current &&
    typeof current !== 'function' &&
    typeof current === 'object' &&
    'default' in current
  ) {
    current = current.default;
  }

  if (typeof current !== 'function') {
    throw new Error('Failed to resolve Yoast researcher constructor');
  }

  return current;
};

const EnglishResearcher = resolveConstructor(EnglishResearcherModule);

// eslint-disable-next-line no-restricted-globals
const worker = new AnalysisWebWorker(self, new EnglishResearcher());
worker.register();
