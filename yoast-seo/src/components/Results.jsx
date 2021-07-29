import React from 'react';
import PropTypes from 'prop-types';
import { interpreters } from 'yoastseo';

import ResultGroup from './ResultGroup';

const scoreKeyToTitle = {
  feedback: 'Feedback',
  bad: 'Problems',
  ok: 'Improvements',
  good: 'Good results',
};

function groupResults(results) {
  let groupedResults = {};

  results.forEach((result) => {
    const scoreKey = interpreters.scoreToRating(result.score);

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

export default function Results({ assessment }) {
  if (!assessment) {
    return null;
  }

  const groupedResults = groupResults(assessment.results);

  return (
    <ul className="yoast-seo__results">
      {Object.keys(groupedResults).map((key) => (
        <ResultGroup key={key} result={groupedResults[key]} />
      ))}
    </ul>
  );
}

Results.propTypes = {
  assessment: PropTypes.arrayOf(PropTypes.object),
};
