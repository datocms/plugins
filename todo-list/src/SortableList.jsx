import React from 'react';
import { SortableContainer, SortableElement } from 'react-sortable-hoc';

import TodoItem from './TodoItem.jsx';

const SortableTodoItem = SortableElement(TodoItem);

/* eslint-disable react/no-array-index-key */

export default SortableContainer(({
  todos,
  onEdit,
  onToggleComplete,
  onEnter,
  onDelete,
  onBlur,
}) => (
  <div>
    {
      todos.map((todo, index) => (
        <SortableTodoItem
          sortable
          disabled={todo.temp}
          key={`item-${index}`}
          index={index}
          todo={todo}
          temp={todo.temp}
          onEdit={onEdit.bind(this, index)}
          onEnter={onEnter.bind(this, index)}
          onToggleComplete={onToggleComplete.bind(this, index)}
          onDelete={onDelete.bind(this, index)}
          onBlur={onBlur.bind(this)}
        />
      ))
    }
  </div>
));
