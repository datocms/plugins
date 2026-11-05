import Button from 'datocms-react-ui/Button';
import { Dropdown, useCloseMenu } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import StringInput from 'datocms-react-ui/StringInput';
import { type FormEvent, useRef, useState } from 'react';
import type { Column } from 'react-table';
import {
  ActionToggleIcon,
  AddIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DeleteIcon,
  EditIcon,
} from '../../icons';
import type { Actions, Row } from '../../types';
import { useMenuRoom } from '../../utils/useMenuRoom';
import s from './style.module.css';

type Props = Actions & {
  value: string;
  row: { index: number };
  column: Column<Row>;
  columns: Column<Row>[];
  disabled?: boolean;
};

type MenuProps = Pick<
  Props,
  | 'columns'
  | 'onColumnRename'
  | 'onAddColumn'
  | 'onMoveColumn'
  | 'onRemoveColumn'
> & { id: string | undefined };

// The menu renders this only while it is open, thus each opening starts on
// the options, and the rename form starts from the current name.
function ColumnMenu({
  id,
  columns,
  onColumnRename,
  onAddColumn,
  onMoveColumn,
  onRemoveColumn,
}: MenuProps) {
  const closeMenu = useCloseMenu();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(id ?? '');
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the column a name.');
      return;
    }

    if (columns.find((c) => c.id === name)) {
      setError('Column names must be unique.');
      return;
    }

    if (!id) {
      return;
    }

    onColumnRename(id, name);
    closeMenu();
  };

  if (renaming) {
    // The menu stops Enter (it picks the highlighted option): in the form,
    // Enter submits the new name.
    return (
      <form
        onSubmit={submit}
        onKeyDown={(event) => event.key === 'Enter' && event.stopPropagation()}
      >
        <div className="Dropdown__menu__body">
          <FieldWrapper label="Column name" error={error}>
            <StringInput
              value={name}
              onChange={(newName) => {
                setName(newName ?? '');
                setError(undefined);
              }}
              autoFocus
            />
          </FieldWrapper>
          <Button tone="primary" size="small" submit label="Rename" />
        </div>
      </form>
    );
  }

  if (!id) {
    return null;
  }

  const columnIndex = columns.findIndex((c) => c.id === id);

  return (
    <>
      <Dropdown.Option
        icon={<EditIcon />}
        closeMenuOnClick={false}
        onPick={() => setRenaming(true)}
      >
        Rename
      </Dropdown.Option>
      <Dropdown.Separator />
      <Dropdown.Option
        icon={<ArrowLeftIcon />}
        disabled={
          columnIndex === 0 ? { reason: 'This is the first column.' } : false
        }
        onPick={() => onMoveColumn(id, true)}
      >
        Move left
      </Dropdown.Option>
      <Dropdown.Option
        icon={<ArrowRightIcon />}
        disabled={
          columnIndex === columns.length - 1
            ? { reason: 'This is the last column.' }
            : false
        }
        onPick={() => onMoveColumn(id, false)}
      >
        Move right
      </Dropdown.Option>
      <Dropdown.Separator />
      <Dropdown.Option icon={<AddIcon />} onPick={() => onAddColumn(id, true)}>
        Add column to the left
      </Dropdown.Option>
      <Dropdown.Option icon={<AddIcon />} onPick={() => onAddColumn(id, false)}>
        Add column to the right
      </Dropdown.Option>
      <Dropdown.Separator />
      <Dropdown.Option
        icon={<DeleteIcon />}
        alert
        onPick={() => onRemoveColumn(id)}
      >
        Delete column
      </Dropdown.Option>
    </>
  );
}

export default function EditableHeader({
  column: { id },
  columns,
  onColumnRename,
  onAddColumn,
  onMoveColumn,
  onRemoveColumn,
  disabled,
}: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const menuRef = useMenuRoom(anchor);

  return (
    <>
      <span className={s.name}>{id}</span>
      {!disabled && (
        <div ref={anchor}>
          <Dropdown
            triggerComponent={IconTrigger}
            icon={ActionToggleIcon}
            label={`Actions for column “${id}”`}
          >
            <Dropdown.Menu
              ref={menuRef}
              placement="bottom-end"
              contextualSearch={false}
            >
              <ColumnMenu
                id={id}
                columns={columns}
                onColumnRename={onColumnRename}
                onAddColumn={onAddColumn}
                onMoveColumn={onMoveColumn}
                onRemoveColumn={onRemoveColumn}
              />
            </Dropdown.Menu>
          </Dropdown>
        </div>
      )}
    </>
  );
}
