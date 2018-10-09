import React from 'react';
import PropTypes from 'prop-types';
import parse from 'date-fns/parse';
import format from 'date-fns/format';
import differenceInWeeks from 'date-fns/difference_in_weeks';
import Textarea from 'react-textarea-autosize';
import cn from 'classname';
import AutoUpdateTime from './AutoUpdateTime.jsx';

export default class Note extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      comment: props.note.comment,
      focus: false,
    };
  }

  handleChange(e) {
    this.setState({ comment: e.target.value });
  }

  handleFocus() {
    this.setState({ focus: true });
  }

  handleBlur(e) {
    const { onEdit } = this.props;

    this.setState({ focus: false });
    onEdit(e.target.value);
  }

  render() {
    const { note, onDelete } = this.props;
    const { comment, focus } = this.state;

    const date = parse(note.timestamp);

    return (
      <div key={note.timestamp} className={cn('notes__item', { 'in-focus': focus })}>
        <Textarea
          value={comment}
          placeholder="Insert your note here..."
          onFocus={this.handleFocus.bind(this)}
          onChange={this.handleChange.bind(this)}
          onBlur={this.handleBlur.bind(this)}
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
