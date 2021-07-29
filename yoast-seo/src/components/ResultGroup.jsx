import React, { useState } from 'react';
import PropTypes from 'prop-types';

import ScoreIcon from './ScoreIcon';

export default function ResultItem({ result }) {
  const [isOpen, setIsOpen] = useState(true);

  function togglePanel() {
    setIsOpen(!isOpen);
  }

  return (
    <li className="yoast-seo__result-group">
      <button
        type="button"
        className="yoast-seo__result-group-title"
        onClick={togglePanel}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          className={`yoast-seo__arrow ${
            isOpen ? 'yoast-seo__arrow-up' : 'yoast-seo__arrow-down'
          }`}
        >
          <path d="M6.53 18.86l26.63 25.26 24.26-25.26" />
        </svg>
        {result.title} ({result.items.length})
      </button>
      {isOpen ? (
        <ul>
          {result.items.map((item) => (
            <li className="yoast-seo__result-item" key={item._identifier}>
              <div>
                <ScoreIcon score={item.score} />
              </div>
              <p dangerouslySetInnerHTML={{ __html: item.text }} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

ResultItem.propTypes = {
  result: PropTypes.shape({
    title: PropTypes.string.isRequired,
    items: PropTypes.arrayOf(PropTypes.object),
  }),
};
