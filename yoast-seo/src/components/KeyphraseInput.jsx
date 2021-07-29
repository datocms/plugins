import React, { useState } from 'react';
import PropTypes from 'prop-types';

export default function KeyphraseInput({
  initialValue = '',
  isFormSubmitting,
  onChange,
  onFormSubmit,
}) {
  const [value, setValue] = useState(initialValue);

  function handleInputChange(event) {
    setValue(event.target.value);
  }

  function handleInputBlur() {
    onChange(value);
  }

  /**
   *  TODO:
   *  This is supposed to be a <form /> so when `return` key is process it analyzes
   *  But for some reason the current value wasn't getting updated correctly and
   *  as a result it is taking the previos inputed value
   */
  return (
    <div className="yoast-seo__form-inline">
      <div className="yoast-seo__form-field">
        <label
          htmlFor="yoastParams.focusKeyphrase"
          id="yoastParams.focusKeyphrase.label"
        >
          Focus Keyphrase
        </label>

        <input
          id="yoastParams.focusKeyphrase"
          aria-labelledby="yoastParams.focusKeyphrase.label"
          placeholder="Enter focus keyword"
          type="text"
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          value={value}
        />
      </div>

      <div className="yoast-seo__form-button">
        <button
          type="submit"
          onClick={onFormSubmit}
          className="DatoCMS-button DatoCMS-button--primary"
          disabled={isFormSubmitting}
        >
          {isFormSubmitting ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
    </div>
  );
}

KeyphraseInput.propTypes = {
  initialValue: PropTypes.string,
  isFormSubmitting: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onFormSubmit: PropTypes.func.isRequired,
};
