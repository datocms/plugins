import React from 'react';
import { render } from 'react-dom';
import cn from 'classname';
import u from 'updeep';
import { arrayMove } from 'react-sortable-hoc';

import TodoItem from './TodoItem.jsx';
import SortableList from './SortableList.jsx';

import './style.sass';

function deserialize(plugin) {
  const fieldValue = plugin.getFieldValue(plugin.fieldPath);
  const { initialTodos } = plugin.parameters.instance;

  if (!fieldValue) {
    if (initialTodos) {
      return {
        complete: [],
        incomplete: initialTodos.split(/\n/).map(todo => ({ todo, completedAt: null })),
      };
    }

    return { complete: [], incomplete: [] };
  }

  return JSON.parse(fieldValue);
}

function serialize(todos) {
  return JSON.stringify(todos);
}

window.DatoCmsPlugin.init().then((plugin) => {
  plugin.startAutoResizer();

  class App extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        todos: deserialize(plugin),
        tempTodo: '',
        showComplete: false,
        sortingInProgress: false,
      };
    }

    componentDidMount() {
      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        this.setState({ todos: deserialize(plugin) });
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    handleToggleShowComplete() {
      this.setState(state => ({ showComplete: !state.showComplete }));
    }

    handleBlur() {
      const { todos } = this.state;
      this.changeValue(todos);
    }

    handleEnter(category, index, el) {
      const { todos } = this.state;

      const insertElement = category !== 'incomplete'
        || index !== todos.incomplete.length - 1;

      if (insertElement) {
        const newTodo = { todo: '', completedAt: null };

        this.changeValue(u({
          [category]: items => (
            items.slice(0, index + 1).concat([newTodo], items.slice(index + 1))
          ),
        }, todos));
      }

      setTimeout(
        () => (
          (
            el.parentElement.parentElement.nextSibling
            || el.parentElement.parentElement.parentElement.nextSibling
          ).querySelector('textarea').focus()
        ),
        100,
      );
    }

    handleEdit(category, index, todo) {
      this.setState(state => ({
        todos: u({ [category]: { [index]: todo } }, state.todos),
      }));
    }

    handleToggleComplete(category, index, complete) {
      const { todos } = this.state;
      const otherCategory = category === 'complete' ? 'incomplete' : 'complete';
      const completedAt = complete ? (new Date()).toISOString() : null;
      const item = u({ completedAt }, todos[category][index]);

      this.changeValue(u({
        [category]: items => items.filter((todo, i) => i !== index),
        [otherCategory]: items => items.concat([item]),
      }, todos));
    }

    handleDelete(category, index) {
      const { todos } = this.state;

      this.changeValue(u({
        [category]: items => items.filter((todo, i) => i !== index),
      }, todos));
    }

    handleSortStart() {
      this.setState({ sortingInProgress: true });
    }

    handleSortEnd({ oldIndex, newIndex }) {
      const { todos } = this.state;

      this.changeValue(u({
        incomplete: items => arrayMove(items, oldIndex, newIndex),
      }, todos));

      this.setState({ sortingInProgress: false });
    }

    changeValue(newTodos) {
      return plugin.setFieldValue(plugin.fieldPath, serialize(newTodos));
    }

    renderTodo(category, todo, index) {
      return (
        <TodoItem
          key={index}
          todo={todo}
          temp={todo.temp}
          onEdit={this.handleEdit.bind(this, category, index)}
          onEnter={this.handleEnter.bind(this, category, index)}
          onToggleComplete={this.handleToggleComplete.bind(this, category, index)}
          onDelete={this.handleDelete.bind(this, category, index)}
          onBlur={this.handleBlur.bind(this)}
        />
      );
    }

    render() {
      const {
        todos: { complete, incomplete },
        tempTodo,
        showComplete,
        sortingInProgress,
      } = this.state;

      const incompleteWithTemp = incomplete.concat([{
        todo: tempTodo,
        completedAt: null,
        temp: true,
      }]);

      return (
        <div className={cn('todos', { 'is-sorting': sortingInProgress })}>
          <SortableList
            useDragHandle
            helperClass="todos__item__helper"
            lockAxis="y"
            todos={incompleteWithTemp}
            onSortStart={this.handleSortStart.bind(this)}
            onEdit={this.handleEdit.bind(this, 'incomplete')}
            onEnter={this.handleEnter.bind(this, 'incomplete')}
            onToggleComplete={this.handleToggleComplete.bind(this, 'incomplete')}
            onDelete={this.handleDelete.bind(this, 'incomplete')}
            onBlur={this.handleBlur.bind(this)}
            onSortEnd={this.handleSortEnd.bind(this)}
          />
          {
            complete.length > 0
            && (
              <div className={cn('todos__completed', { 'is-open': showComplete })}>
                <button
                  className="todos__completed__title"
                  type="button"
                  onClick={this.handleToggleShowComplete.bind(this)}
                >
                  {complete.length}
                  &nbsp;completed tasks
                </button>
                {
                  showComplete
                  && complete.map(this.renderTodo.bind(this, 'complete'))
                }
              </div>
            )
          }
        </div>
      );
    }
  }

  render(<App />, document.body);
});
