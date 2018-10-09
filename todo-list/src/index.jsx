import React from 'react';
import { render } from 'react-dom';
import TodoItem from './TodoItem.jsx';

import './style.sass';

function deserialize(plugin) {
  const fieldValue = plugin.getFieldValue(plugin.fieldPath);

  if (!fieldValue) {
    if (plugin.parameters.instance.initialTodos) {
      return plugin.parameters.instance.initialTodos.split(/\n/).map(todo => ({
        todo,
        completedAt: null,
      }));
    }

    return [];
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

    handleEdit(index, todo) {
      this.setState(state => ({
        todos: Object.assign(
          [], state.todos,
          {
            [index]: Object.assign({}, state.todos[index], { todo }),
          },
        ),
      }));
    }

    handleBlur() {
      const { todos } = this.state;
      plugin.setFieldValue(plugin.fieldPath, serialize(todos));
    }

    handleToggleComplete(index, complete) {
      const { todos } = this.state;

      plugin.setFieldValue(
        plugin.fieldPath,
        serialize(Object.assign(
          [], todos,
          {
            [index]: Object.assign(
              {}, todos[index],
              {
                completedAt: complete ? (new Date()).toISOString() : null,
              },
            ),
          },
        )),
      );
    }

    handleDelete(index) {
      const { todos } = this.state;

      plugin.setFieldValue(
        plugin.fieldPath,
        serialize(todos.filter((todo, i) => i !== index)),
      );
    }

    renderTodo(todo, i) {
      return (
        <TodoItem
          key={i}
          todo={todo}
          onEdit={this.handleEdit.bind(this, i)}
          onToggleComplete={this.handleToggleComplete.bind(this, i)}
          onDelete={this.handleDelete.bind(this, i)}
          onBlur={this.handleBlur.bind(this)}
        />
      );
    }

    render() {
      const { todos, tempTodo } = this.state;

      const allTodos = todos.concat({ todo: tempTodo });
      const incomplete = allTodos.filter(t => !t.completedAt);
      const complete = allTodos.filter(t => t.completedAt);

      return (
        <div className="todos">
          {incomplete.map(this.renderTodo.bind(this))}
          {
            complete.length > 0
            && (
              <div className="todos__completed">
                <div className="todos__completed__title">
                  {complete.length}
                  &nbsp;completed tasks
                </div>
                {complete.map(this.renderTodo.bind(this))}
              </div>
            )
          }
        </div>
      );
    }
  }

  render(<App />, document.body);
});
