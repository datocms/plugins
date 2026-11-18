import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import CardList from 'datocms-react-ui/CardList';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import {
  DragHandle,
  reorder,
  type SortableDropResult,
  SortableItem,
  type SortableItemApi,
  SortableList,
} from 'datocms-react-ui/dnd';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import StringInput from 'datocms-react-ui/StringInput';
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DeleteIcon,
  EditIcon,
  EllipsisVerticalIcon,
  PlusIcon,
} from '../icons';
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

type ListKey = keyof TodosValue;

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

/** The attribute that finds the "⋮" of a task, to give it the focus back */
const MENU_ATTRIBUTE = 'data-todo-menu';

function focusMenuOf(id: string) {
  document
    .querySelector<HTMLElement>(`[${MENU_ATTRIBUTE}="${id}"] [aria-haspopup]`)
    ?.focus({ preventScroll: true });
}

/** The open row menu that the frame keeps room for (one is open at a time) */
let roomHolder: HTMLElement | null = null;

/**
 * The field's frame is only as tall as its tasks, and the kit fits an open
 * menu inside the frame, so in a short list a task's menu would scroll in a
 * sliver. While a menu is open, the frame keeps room for all of it under its
 * trigger (4px away, plus the 30px the kit keeps from the edge): the
 * auto-resizer grows the frame, and shrinks it back once the menu closes.
 * The kit fills the menu's portal right after setting its ref.
 */
function useMenuRoom(anchor: RefObject<HTMLElement | null>) {
  const openMenu = useRef<HTMLElement | null>(null);

  return useCallback(
    (menu: HTMLDivElement | null) => {
      const root = document.documentElement;
      if (openMenu.current && roomHolder === openMenu.current) {
        roomHolder = null;
        root.style.minHeight = '';
      }
      openMenu.current = menu;
      if (!menu) return;

      queueMicrotask(() => {
        if (!anchor.current || !menu.isConnected) return;
        const panel = menu.querySelector('[role="menu"]') ?? menu;
        const bottom = anchor.current.getBoundingClientRect().bottom;
        roomHolder = menu;
        root.style.minHeight = `${Math.ceil(
          bottom + window.scrollY + 4 + panel.scrollHeight + 30,
        )}px`;
      });
    },
    [anchor],
  );
}

type TaskMenuProps = {
  todo: Todo;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (to: number) => void;
  onDelete: () => void;
};

/** The "⋮" of a task. Move up and Move down are the keyboard's reorder. */
function TaskMenu({
  todo,
  index,
  count,
  onEdit,
  onMove,
  onDelete,
}: TaskMenuProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const menuRef = useMenuRoom(anchor);

  return (
    <div ref={anchor} {...{ [MENU_ATTRIBUTE]: todo.id }}>
      <Dropdown
        triggerComponent={IconTrigger}
        icon={EllipsisVerticalIcon}
        label={`Actions for “${todo.todo}”`}
      >
        <Dropdown.Menu ref={menuRef} placement="bottom-end">
          <Dropdown.Option icon={<EditIcon />} onPick={onEdit}>
            Edit
          </Dropdown.Option>
          {index > 0 && (
            <Dropdown.Option
              icon={<ArrowUpIcon />}
              onPick={() => onMove(index - 1)}
            >
              Move up
            </Dropdown.Option>
          )}
          {index < count - 1 && (
            <Dropdown.Option
              icon={<ArrowDownIcon />}
              onPick={() => onMove(index + 1)}
            >
              Move down
            </Dropdown.Option>
          )}
          <Dropdown.Separator />
          <Dropdown.Option icon={<DeleteIcon />} alert onPick={onDelete}>
            Delete
          </Dropdown.Option>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
}

type TaskEditorProps = {
  initialText: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
};

/**
 * The text of a task while the user writes it. Enter or leaving the input
 * saves it, Escape gives up the change.
 */
function TaskEditor({ initialText, onCommit, onCancel }: TaskEditorProps) {
  const [text, setText] = useState(initialText);
  // Enter and Escape end the edit before the blur that follows
  const ended = useRef(false);

  const end = (commit: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (commit) {
      onCommit(text.trim());
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      end(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      end(false);
    }
  };

  // The input takes the focus when it opens: the user asked to write
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    wrapper.current?.querySelector('input')?.focus();
  }, []);

  return (
    <div ref={wrapper} className={s.editor}>
      <StringInput
        value={text}
        onChange={(value) => setText(value ?? '')}
        onBlur={() => end(true)}
        onKeyDown={handleKeyDown}
        aria-label="Task"
        placeholder="Ask for a technical review"
      />
    </div>
  );
}

type TaskItemProps = {
  todo: Todo;
  complete: boolean;
  index: number;
  count: number;
  editing: boolean;
  disabled: boolean;
  sortable: SortableItemApi;
  onToggle: () => void;
  onStartEdit: () => void;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onMove: (to: number) => void;
  onDelete: () => void;
};

/**
 * One task: the grip, the checkbox with the text, and the "⋮" with its
 * changes. While the user writes it, the text is an input.
 */
function TaskItem({
  todo,
  complete,
  index,
  count,
  editing,
  disabled,
  sortable,
  onToggle,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onMove,
  onDelete,
}: TaskItemProps) {
  return (
    <CardList.Item
      ref={sortable.ref}
      className={s.item}
      row={{
        summary: (
          <>
            {!disabled && count > 1 && (
              <DragHandle ref={sortable.handleRef} gutter="normal" />
            )}
            {editing ? (
              <TaskEditor
                initialText={todo.todo}
                onCommit={onCommitEdit}
                onCancel={onCancelEdit}
              />
            ) : (
              <label className={s.task}>
                <input
                  type="checkbox"
                  checked={complete}
                  disabled={disabled}
                  onChange={onToggle}
                />
                <span className={complete ? s.completedText : undefined}>
                  {todo.todo}
                </span>
              </label>
            )}
            {/* The item is positioned: the drop line goes on its edges */}
            {sortable.dropIndicator}
          </>
        ),
        actions: !disabled && !editing && (
          <TaskMenu
            todo={todo}
            index={index}
            count={count}
            onEdit={onStartEdit}
            onMove={onMove}
            onDelete={onDelete}
          />
        ),
      }}
    />
  );
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
  // The task whose text is an input. A new task stays out of the value
  // until it has a text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Todo | null>(null);
  // The task whose "⋮" takes the focus back after a move
  const followMove = useRef<string | null>(null);
  const disabled = ctx.disabled;

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

  // A move puts the item somewhere else in the page, which drops its focus
  useLayoutEffect(() => {
    if (!followMove.current) return;
    focusMenuOf(followMove.current);
    followMove.current = null;
  });

  const toggle = (key: ListKey, index: number) => {
    if (key === 'complete') {
      const target = todos.complete[index];
      void persist({
        complete: todos.complete.filter((_, i) => i !== index),
        incomplete: [...todos.incomplete, { ...target, completedAt: null }],
      });
      return;
    }

    const target = todos.incomplete[index];
    void persist({
      complete: [
        ...todos.complete,
        { ...target, completedAt: new Date().toISOString() },
      ],
      incomplete: todos.incomplete.filter((_, i) => i !== index),
    });
  };

  const move = (key: ListKey, from: number, to: number) => {
    const list = [...todos[key]];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    followMove.current = item.id;
    void persist({ ...todos, [key]: list });
  };

  const drop = (key: ListKey) => (result: SortableDropResult) => {
    void persist({ ...todos, [key]: reorder(todos[key], result) });
  };

  const remove = (key: ListKey, index: number) => {
    void persist({
      ...todos,
      [key]: todos[key].filter((_, i) => i !== index),
    });
  };

  const commitEdit = (key: ListKey, index: number, text: string) => {
    setEditingId(null);
    // An empty text keeps the task as it was
    if (!text) return;
    void persist({
      ...todos,
      [key]: todos[key].map((todo, i) =>
        i === index ? { ...todo, todo: text } : todo,
      ),
    });
  };

  const addTask = () => {
    const todo: Todo = {
      id: crypto.randomUUID(),
      todo: '',
      completedAt: null,
    };
    setDraft(todo);
    setEditingId(todo.id);
  };

  const commitDraft = (text: string) => {
    setDraft(null);
    setEditingId(null);
    if (!draft || !text) return;
    void persist({
      ...todos,
      incomplete: [...todos.incomplete, { ...draft, todo: text }],
    });
  };

  const cancelDraft = () => {
    setDraft(null);
    setEditingId(null);
  };

  const renderList = (key: ListKey) => {
    const list = todos[key];
    const complete = key === 'complete';
    const reorderable = !disabled && list.length > 1;

    return list.map((todo, index) => (
      <SortableItem
        key={todo.id}
        id={todo.id}
        index={index}
        disabled={!reorderable}
        handle
      >
        {(sortable) => (
          <TaskItem
            todo={todo}
            complete={complete}
            index={index}
            count={list.length}
            editing={editingId === todo.id}
            disabled={disabled}
            sortable={sortable}
            onToggle={() => toggle(key, index)}
            onStartEdit={() => setEditingId(todo.id)}
            onCommitEdit={(text) => commitEdit(key, index, text)}
            onCancelEdit={() => setEditingId(null)}
            onMove={(to) => move(key, index, to)}
            onDelete={() => remove(key, index)}
          />
        )}
      </SortableItem>
    ));
  };

  const completedCount = todos.complete.length;
  const add = { label: 'Add task', icon: PlusIcon, onClick: addTask };

  return (
    <Canvas ctx={ctx}>
      <div className={s.root}>
        {/* Always rendered, so the tasks don't remount when reordering
            starts to apply: the list is only disabled */}
        <SortableList
          disabled={disabled || todos.incomplete.length < 2}
          onDrop={drop('incomplete')}
        >
          <CardList
            add={disabled || draft ? undefined : add}
            empty={
              <EmptySlot
                message={completedCount > 0 ? 'All tasks done' : 'No tasks yet'}
                action={disabled ? undefined : add}
              />
            }
          >
            {renderList('incomplete')}
            {draft && (
              <CardList.Item
                className={s.item}
                row={{
                  summary: (
                    <TaskEditor
                      initialText=""
                      onCommit={commitDraft}
                      onCancel={cancelDraft}
                    />
                  ),
                }}
              />
            )}
          </CardList>
        </SortableList>

        {completedCount > 0 && (
          <div className={s.completed}>
            <SortableList
              disabled={disabled || completedCount < 2}
              onDrop={drop('complete')}
            >
              <CardList
                header={{
                  title: `${completedCount} completed ${
                    completedCount === 1 ? 'task' : 'tasks'
                  }`,
                  collapse: {
                    open: showComplete,
                    onToggle: () => setShowComplete(!showComplete),
                  },
                }}
              >
                {renderList('complete')}
              </CardList>
            </SortableList>
          </div>
        )}
      </div>
    </Canvas>
  );
}
