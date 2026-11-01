import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import RawButton from 'datocms-react-ui/RawButton';
import TableList, { type TableListColumn } from 'datocms-react-ui/TableList';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from '../icons';
import s from './styles.module.css';

type Todo = {
  id: string;
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

function ensureTodoHasId(todo: Omit<Todo, 'id'> & { id?: string }): Todo {
  return {
    id: todo.id ?? crypto.randomUUID(),
    todo: todo.todo,
    completedAt: todo.completedAt,
  };
}

function readValue(raw: unknown, initialTodos?: string): TodosValue {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw) as TodosValue;
      return {
        complete: parsed.complete.map(ensureTodoHasId),
        incomplete: parsed.incomplete.map(ensureTodoHasId),
      };
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
        .map((todo) => ({ id: crypto.randomUUID(), todo, completedAt: null })),
    };
  }

  return emptyTodos;
}

function stringify(value: TodosValue): string {
  return JSON.stringify(value);
}

// The id of a task's Move up or Move down button
function moveButtonId(complete: boolean, index: number, direction: -1 | 1) {
  return `${complete ? 'todo-completed' : 'todo-open'}-${index}-${
    direction === -1 ? 'up' : 'down'
  }`;
}

export default function FieldExtension({ ctx }: Props) {
  const params = ctx.plugin.attributes.parameters as PluginParameters;
  const rawValue = ctx.formValues[ctx.field.attributes.api_key];
  const initial = useMemo(
    () => readValue(rawValue, params.initialTodos),
    [rawValue, params.initialTodos],
  );
  const [todos, setTodos] = useState<TodosValue>(initial);
  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    setTodos(initial);
  }, [initial]);

  const persist = useCallback(
    async (next: TodosValue) => {
      setTodos(next);
      await ctx.setFieldValue(ctx.fieldPath, stringify(next));
    },
    [ctx],
  );

  const toggleComplete = useCallback(
    async (index: number, complete: boolean) => {
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
        complete: [
          ...todos.complete,
          { ...target, completedAt: new Date().toISOString() },
        ],
        incomplete: todos.incomplete.filter((_, i) => i !== index),
      });
    },
    [todos, persist],
  );

  const moveTodo = useCallback(
    async (index: number, direction: -1 | 1, complete: boolean) => {
      const key = complete ? 'complete' : 'incomplete';
      const list = [...todos[key]];
      const to = index + direction;
      if (to < 0 || to >= list.length) return;
      const [item] = list.splice(index, 1);
      list.splice(to, 0, item);
      // TableList keys its rows by index: the focus follows the moved task
      document.getElementById(moveButtonId(complete, to, direction))?.focus();
      await persist({ ...todos, [key]: list });
    },
    [todos, persist],
  );

  // The same three columns for both lists. The buttons sit in a span, since
  // the direct child of a cell stretches across it. Each onClick returns
  // undefined: a Button whose onClick returns a promise turns busy and drops
  // the focus.
  const [openColumns, completedColumns] = useMemo(() => {
    const columns = (complete: boolean): TableListColumn<Todo>[] => {
      const last = (complete ? todos.complete : todos.incomplete).length - 1;
      return [
        {
          id: 'done',
          label: 'Done',
          grow: 2,
          render: ({ index }) => (
            <span className={s.buttons}>
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={CheckIcon}
                label="Done"
                pressed={complete}
                onClick={() => {
                  void toggleComplete(index, complete);
                }}
              />
            </span>
          ),
        },
        { id: 'todo', field: 'todo', label: 'Task', grow: 3 },
        {
          id: 'order',
          label: 'Order',
          grow: 2,
          render: ({ index }) => (
            <span className={s.buttons}>
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={ArrowUpIcon}
                label="Move up"
                id={moveButtonId(complete, index, -1)}
                disabled={
                  index === 0
                    ? { reason: 'This task is already first.' }
                    : undefined
                }
                onClick={() => {
                  void moveTodo(index, -1, complete);
                }}
              />
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={ArrowDownIcon}
                label="Move down"
                id={moveButtonId(complete, index, 1)}
                disabled={
                  index === last
                    ? { reason: 'This task is already last.' }
                    : undefined
                }
                onClick={() => {
                  void moveTodo(index, 1, complete);
                }}
              />
            </span>
          ),
        },
      ];
    };
    return [columns(false), columns(true)];
  }, [todos, toggleComplete, moveTodo]);

  const completedCount = todos.complete.length;

  return (
    <Canvas ctx={ctx}>
      <div className={s.root}>
        <TableList<Todo>
          ariaLabel="Tasks"
          value={todos.incomplete}
          onChange={(incomplete) => {
            void persist({ ...todos, incomplete });
          }}
          columns={openColumns}
          emptyMessage={completedCount > 0 ? 'No open tasks' : 'No tasks yet'}
          add={{
            label: 'Add task',
            newItem: () => ({
              id: crypto.randomUUID(),
              todo: '',
              completedAt: null,
            }),
          }}
        />

        {completedCount > 0 && (
          <RawButton
            className={s.disclosure}
            expandable={{ open: showComplete }}
            onClick={() => setShowComplete(!showComplete)}
          >
            <DisclosureChevron open={showComplete} />
            {completedCount} completed {completedCount === 1 ? 'task' : 'tasks'}
          </RawButton>
        )}

        {completedCount > 0 && showComplete && (
          <div className={s.completed}>
            <TableList<Todo>
              ariaLabel="Completed tasks"
              value={todos.complete}
              onChange={(complete) => {
                void persist({ ...todos, complete });
              }}
              columns={completedColumns}
              emptyMessage="No completed tasks"
            />
          </div>
        )}
      </div>
    </Canvas>
  );
}
