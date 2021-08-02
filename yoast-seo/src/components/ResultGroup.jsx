import React, { useState } from 'react';
import PropTypes from 'prop-types';
import ScoreIcon from './ScoreIcon';

const ResultItem = ({ item }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li className="Plugin__result-item">
      <div className="Plugin__line-with-decoration">
        <div>
          <ScoreIcon score={item.score} />
        </div>
        <div>
          <p dangerouslySetInnerHTML={{ __html: item.text }} />
          {isOpen && (
            <div className="Plugin__marks">
              {item.marks?.map((mark) => {
                const wholeSentenceHighlighted =
                  mark._properties.marked.indexOf('<yoastmark') === 0 &&
                  mark._properties.marked.endsWith('</yoastmark>') &&
                  mark._properties.marked.split('</yoastmark>').length === 2;

                return (
                  <div
                    key={mark._properties.original}
                    className={`Plugin__mark ${
                      wholeSentenceHighlighted ? '' : 'with-highlights'
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: mark._properties.marked,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        {item.marks?.length > 0 && (
          <button
            className="DatoCMS-button"
            onClick={() => setIsOpen((open) => !open)}
          >
            <svg viewBox="0 0 576 512">
              <path
                fill="currentColor"
                d="M572.52 241.4C518.29 135.59 410.93 64 288 64S57.68 135.64 3.48 241.41a32.35 32.35 0 0 0 0 29.19C57.71 376.41 165.07 448 288 448s230.32-71.64 284.52-177.41a32.35 32.35 0 0 0 0-29.19zM288 400a144 144 0 1 1 144-144 143.93 143.93 0 0 1-144 144zm0-240a95.31 95.31 0 0 0-25.31 3.79 47.85 47.85 0 0 1-66.9 66.9A95.78 95.78 0 1 0 288 160z"
              />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
};
ScoreIcon;
export default function ResultGroup({ rating, result, startOpen }) {
  const [isOpen, setIsOpen] = useState(startOpen);

  function togglePanel() {
    setIsOpen(!isOpen);
  }

  return (
    <div className="Plugin__result-group">
      <button
        type="button"
        className="Plugin__result-group-title"
        onClick={togglePanel}
      >
        <div className="Plugin__line-with-decoration">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              className={`Plugin__arrow ${
                isOpen ? 'Plugin__arrow-up' : 'Plugin__arrow-down'
              }`}
            >
              <path d="M6.53 18.86l26.63 25.26 24.26-25.26" />
            </svg>
          </div>
          <div>
            {!isOpen && <ScoreIcon rating={rating} />} {result.title} (
            {result.items.length})
          </div>
        </div>
      </button>
      {isOpen ? (
        <ul>
          {result.items.map((item) => (
            <ResultItem item={item} key={item._identifier} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

ResultGroup.propTypes = {
  result: PropTypes.shape({
    title: PropTypes.string.isRequired,
    items: PropTypes.arrayOf(PropTypes.object),
    rating: PropTypes.string.isRequired,
  }),
};
