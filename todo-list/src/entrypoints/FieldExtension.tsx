import { Canvas, Button, TextInput, SwitchField } from 'datocms-react-ui';
import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import s from './styles.module.css';

type Todo = {
  todo: string;
  completedAt: string | null;
};

type TodosValue = {
  complete: Todo[];
  incomplete: Todo[];
};

type PluginParameters = {
  initialTodos?: string;
};

type Props = {
  ctx: RenderFieldExtensionCtx;
};

const emptyTodos: TodosValue = {
  complete: [],
  incomplete: [],
};

function readValue(raw: unknown, initialTodos?: string): TodosValue {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      return JSON.parse(raw) as TodosValue;
    } catch {
      return emptyTodos;
    }
  }

  if (initialTodos) {
    return {
      complete: [],
      incomplete: initialTodos
        .split(/\n/g)
        .map((todo) => todo.trim())
        .filter(Boolean)
        .map((todo) => ({ todo, completedAt: null })),
    };
  }

  return emptyTodos;
}

function stringify(value: TodosValue): string {
  return JSON.stringify(value);
}

export default function FieldExtension({ ctx }: Props) {
  const params = ctx.plugin.attributes.parameters as PluginParameters;
  const rawValue = ctx.formValues[ctx.field.attributes.api_key];
  const initial = useMemo(() => readValue(rawValue, params.initialTodos), [rawValue, params.initialTodos]);
  const [todos, setTodos] = useState<TodosValue>(initial);
  const [newTodo, setNewTodo] = useState('');
  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    setTodos(initial);
  }, [initial]);

  const persist = async (next: TodosValue) => {
    setTodos(next);
    await ctx.setFieldValue(ctx.fieldPath, stringify(next));
  };

  const addTodo = async () => {
    const text = newTodo.trim();
    if (!text) return;
    await persist({
      ...todos,
      incomplete: [...todos.incomplete, { todo: text, completedAt: null }],
    });
    setNewTodo('');
  };

  const updateTodo = async (index: number, value: string, complete: boolean) => {
    const key = complete ? 'complete' : 'incomplete';
    const list = [...todos[key]];
    list[index] = { ...list[index], todo: value };
    await persist({ ...todos, [key]: list });
  };

  const toggleComplete = async (index: number, complete: boolean) => {
    if (complete) {
      const target = todos.complete[index];
      await persist({
        complete: todos.complete.filter((_, i) => i !== index),
        incomplete: [...todos.incomplete, { ...target, completedAt: null }],
      });
      return;
    }

    const target = todos.incomplete[index];
    await persist({
      complete: [...todos.complete, { ...target, completedAt: new Date().toISOString() }],
      incomplete: todos.incomplete.filter((_, i) => i !== index),
    });
  };

  const removeTodo = async (index: number, complete: boolean) => {
    const key = complete ? 'complete' : 'incomplete';
    await persist({
      ...todos,
      [key]: todos[key].filter((_, i) => i !== index),
    });
  };

  const moveTodo = async (index: number, direction: -1 | 1, complete: boolean) => {
    const key = complete ? 'complete' : 'incomplete';
    const list = [...todos[key]];
    const to = index + direction;
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(to, 0, item);
    await persist({ ...todos, [key]: list });
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.root}>
        <div className={s.newRow}>
          <TextInput
            value={newTodo}
            placeholder="Add a new task"
            onChange={(value) => setNewTodo(value)}
          />
          <Button buttonSize="s" onClick={addTodo}>
            Add
          </Button>
        </div>

        <div className={s.list}>
          {todos.incomplete.map((todo, index) => (
            <div className={s.item} key={`incomplete-${index}`}>
              <TextInput
                value={todo.todo}
                onChange={(value) => {
                  void updateTodo(index, value, false);
                }}
              />
              <Button buttonSize="xxs" onClick={() => void moveTodo(index, -1, false)}>↑</Button>
              <Button buttonSize="xxs" onClick={() => void moveTodo(index, 1, false)}>↓</Button>
              <Button buttonSize="xxs" onClick={() => void toggleComplete(index, false)}>Done</Button>
              <Button buttonSize="xxs" buttonType="negative" onClick={() => void removeTodo(index, false)}>Delete</Button>
            </div>
          ))}
        </div>

        {todos.complete.length > 0 && (
          <div className={s.completed}>
            <SwitchField
              name="showCompleted"
              id="showCompleted"
              label={`Show completed (${todos.complete.length})`}
              value={showComplete}
              onChange={setShowComplete}
            />

            {showComplete && (
              <div className={s.list}>
                {todos.complete.map((todo, index) => (
                  <div className={s.item} key={`complete-${index}`}>
                    <TextInput
                      value={todo.todo}
                      onChange={(value) => {
                        void updateTodo(index, value, true);
                      }}
                    />
                    <Button buttonSize="xxs" onClick={() => void moveTodo(index, -1, true)}>↑</Button>
                    <Button buttonSize="xxs" onClick={() => void moveTodo(index, 1, true)}>↓</Button>
                    <Button buttonSize="xxs" onClick={() => void toggleComplete(index, true)}>Undo</Button>
                    <Button buttonSize="xxs" buttonType="negative" onClick={() => void removeTodo(index, true)}>Delete</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Canvas>
  );
}
