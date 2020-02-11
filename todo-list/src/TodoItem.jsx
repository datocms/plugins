import React from 'react';
import PropTypes from 'prop-types';
import parse from 'date-fns/parse';
import format from 'date-fns/format';
import differenceInWeeks from 'date-fns/difference_in_weeks';
import Textarea from 'react-textarea-autosize';
import cn from 'classname';
import { SortableHandle } from 'react-sortable-hoc';

import AutoUpdateTime from './AutoUpdateTime.jsx';

const Handle = SortableHandle(() => (
  <div className="todos__item__handle" />
));

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
    const { onEdit, todo } = this.props;
    onEdit({ todo: e.target.value, completedAt: todo.completedAt });
  }

  handleKeyDown(e) {
    const { onEnter } = this.props;

    if (e.keyCode === 13) {
      e.target.blur();
      e.stopPropagation();
      this.setState({ focus: false });
      onEnter(e.target);
    }
  }

  render() {
    const {
      temp,
      todo,
      onDelete,
      onToggleComplete,
      sortable,
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
        <div className="todos__item__handle-container">
          {
            sortable && !temp
              && <Handle />
          }
        </div>
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
            disabled={!!todo.completedAt}
            onKeyDown={this.handleKeyDown.bind(this)}
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
  onEnter: () => {},
  temp: false,
  sortable: false,
};

TodoItem.propTypes = {
  todo: PropTypes.shape({
    todo: PropTypes.string.isRequired,
    completedAt: PropTypes.string,
    timestamp: PropTypes.string,
  }).isRequired,
  temp: PropTypes.bool,
  sortable: PropTypes.bool,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  onToggleComplete: PropTypes.func,
  onBlur: PropTypes.func,
  onEnter: PropTypes.func,
};
