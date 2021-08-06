import React from 'react';
import Results from './Results';

export default function Seo({
  analysis,
  keyword,
  synonyms,
  setKeyword,
  setSynonyms,
  onRemove,
}) {
  return (
    <div className="Plugin__seo">
      <div className="Plugin__form">
        <div className="Plugin__form__field">
          <label htmlFor="keyword">Focus keyword</label>
          <input
            name="keyword"
            placeholder="Enter focus keyword"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="Plugin__form__field">
          <label htmlFor="synonyms">Synonyms (separate with commas)</label>
          <input
            name="synonyms"
            placeholder="Enter keyword synonyms"
            type="text"
            value={synonyms}
            onChange={(e) => setSynonyms(e.target.value)}
          />
        </div>
      </div>
      {analysis && keyword && <Results assessment={analysis} key={keyword} />}
      {onRemove && (
        <button
          className="DatoCMS-button DatoCMS-button--alert DatoCMS-button--tiny"
          onClick={onRemove}
        >
          Remove this keyword
        </button>
      )}
    </div>
  );
}
