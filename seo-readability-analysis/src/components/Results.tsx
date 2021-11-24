import { AnalysisAssessment, AnalysisResult } from '../types';
import * as interpreters from "yoastseo/src/interpreters";
import ResultGroup, { Group } from './ResultGroup';

const scoreKeyToTitle: Partial<Record<string, string>> = {
  feedback: 'Feedback',
  bad: 'Problems',
  ok: 'Improvements',
  good: 'Good results',
};

function groupResults(results: AnalysisResult[]) {
  let groupedResults: Record<string, Group> = {};

  results.forEach((result) => {
    const scoreKey: string = interpreters.scoreToRating(result.score);

    if (groupedResults[scoreKey]) {
      groupedResults[scoreKey].items = [
        ...groupedResults[scoreKey].items,
        result,
      ];
    } else {
      groupedResults = {
        ...groupedResults,
        [scoreKey]: {
          scoreKey,
          title: scoreKeyToTitle[scoreKey] || scoreKey,
          items: [result],
        },
      };
    }
  });

  return groupedResults;
}

export default function Results({ assessment }: { assessment: AnalysisAssessment | undefined }) {
  if (!assessment) {
    return null;
  }

  const groupedResults = groupResults(assessment.results);

  return (
    <div className="Plugin__results">
      {['bad', 'ok', 'good', 'feedback']
        .filter((key) => groupedResults[key])
        .map((key) => (
          <ResultGroup
            key={key}
            rating={key}
            result={groupedResults[key]}
            startOpen={key !== 'good'}
          />
        ))}
    </div>
  );
}