import React from 'react';
import PropTypes from 'prop-types';
import parse from 'date-fns/parse';
import format from 'date-fns/format';
import differenceInWeeks from 'date-fns/difference_in_weeks';
import Textarea from 'react-textarea-autosize';
import cn from 'classname';
import AutoUpdateTime from './AutoUpdateTime.jsx';

export default class TodoItem extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      focus: false,
    };
  }

  handleFocus() {
    this.setState({ focus: true });
  }

  handleBlur() {
    const { onBlur } = this.props;
    this.setState({ focus: false });
    onBlur();
  }

  handleEdit(e) {
    const { onEdit } = this.props;
    onEdit(e.target.value);
  }

  render() {
    const {
      temp,
      todo,
      onDelete,
      onToggleComplete,
    } = this.props;

    const { focus } = this.state;

    const date = todo.completedAt && parse(todo.completedAt);

    return (
      <div
        key={todo.timestamp}
        className={
          cn(
            'todos__item',
            {
              'in-focus': focus,
              'is-checked': !!todo.completedAt,
            },
          )
        }
      >
        {
          temp
            ? <div className="todos__item__plus" />
            : (
              <button
                type="button"
                onClick={onToggleComplete.bind(this, !todo.completedAt)}
                className="todos__item__check"
              />
            )
        }
        <div className="todos__item__text">
          <Textarea
            value={todo.todo}
            placeholder="Write something..."
            onFocus={this.handleFocus.bind(this)}
            onChange={this.handleEdit.bind(this)}
            onBlur={this.handleBlur.bind(this)}
          />
          {
            date
              && (
                <div className="todos__item__timestamp">
                  Completed&nbsp;
                  {
                    differenceInWeeks(new Date(), date) > 2
                      ? format(date, 'D MMM YYY')
                      : <AutoUpdateTime value={date} />
                  }
                </div>
              )
          }
        </div>
        {
          !temp
          && (
            <button
              type="button"
              onClick={onDelete}
              className="todos__item__delete"
            />
          )
        }
      </div>
    );
  }
}

TodoItem.defaultProps = {
  onDelete: () => {},
  onToggleComplete: () => {},
  onBlur: () => {},
};

TodoItem.propTypes = {
  todo: PropTypes.shape({
    todo: PropTypes.string.isRequired,
    completedAt: PropTypes.string.isRequired,
  }).isRequired,
  temp: PropTypes.bool.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  onToggleComplete: PropTypes.func,
  onBlur: PropTypes.func,
};
