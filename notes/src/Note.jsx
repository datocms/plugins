import React from 'react';
import PropTypes from 'prop-types';
import parse from 'date-fns/parse';
import format from 'date-fns/format';
import differenceInWeeks from 'date-fns/difference_in_weeks';
import Textarea from 'react-textarea-autosize';
import AutoUpdateTime from './AutoUpdateTime.jsx';

export default class Note extends React.Component {
  handleChange(e) {
    const { onEdit } = this.props;

    onEdit(e.target.value);
  }

  render() {
    const { note, onDelete } = this.props;

    const date = parse(note.timestamp);

    return (
      <div key={note.timestamp} className="notes__item">
        <Textarea
          value={note.comment}
          placeholder="Insert your note here..."
          onChange={this.handleChange.bind(this)}
        />
        <div className="notes__item__timestamp">
          {
            differenceInWeeks(new Date(), date) > 2
              ? format(date, 'D MMM YYY')
              : <AutoUpdateTime value={date} />
          }
          &nbsp;•&nbsp;
          <button
            type="button"
            onClick={onDelete}
            className="notes__item__delete"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }
}

Note.propTypes = {
  note: PropTypes.shape({
    comment: PropTypes.string.isRequired,
    timestamp: PropTypes.string.isRequired,
  }).isRequired,
  onDelete: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
};
