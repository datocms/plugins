import React from 'react';
import PropTypes from 'prop-types';
import { interpreters } from 'yoastseo';

// https://github.com/Yoast/javascript/blob/develop/packages/style-guide/src/colors.json
const scoreRatingColorMapping = {
  feedback: '#888',
  bad: '#dc3232',
  ok: '#ee7c1b',
  good: '#7ad03a',
};
export default function ScoreIcon({ score }) {
  const scoreRating = interpreters.scoreToRating(score);
  const scoreColor =
    scoreRatingColorMapping[scoreRating] || scoreRatingColorMapping.feedback;

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        fill={scoreColor}
        width="10"
        height="10"
      >
        <path d="M256 0C115.39 0 0 115.39 0 256s115.39 256 256 256 256-115.39 256-256S396.61 0 256 0z" />
      </svg>{' '}
    </>
  );
}

ScoreIcon.propTypes = {
  score: PropTypes.number.isRequired,
};
