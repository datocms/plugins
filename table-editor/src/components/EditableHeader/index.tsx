import { Column } from 'react-table';
import { Actions, Row } from '../../types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCog,
  faLongArrowAltLeft,
  faLongArrowAltRight,
  faPen,
  faTimes,
  faTrashAlt,
} from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  DropdownSeparator,
  TextField,
  useCtx,
} from 'datocms-react-ui';
import s from './style.module.css';
import { useEffect, useState } from 'react';

type Props = Actions & {
  value: string;
  row: { index: number };
  column: Column<Row>;
  columns: Column<Row>[];
};

export default function EditableHeader({
  column: { id },
  columns,
  onColumnRename,
  onAddColumn,
  onMoveColumn,
  onRemoveColumn,
}: Props) {
  const ctx = useCtx();
  const [panel, setPanel] = useState('root');
  const [nameValue, setNameValue] = useState(id!);

  useEffect(() => {
    setNameValue(id!);
  }, [id, setNameValue]);

  const handleChangeName = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!nameValue) {
      ctx.alert('Please provide a valid name');
      return;
    }

    if (columns.find((c) => c.id === nameValue)) {
      ctx.alert('Column names must be unique!');
      return;
    }

    onColumnRename(id!, nameValue);
  };

  const columnIndex = columns.findIndex((c) => c.id === id);

  return (
    <>
      <Dropdown
        renderTrigger={({ onClick }) => (
          <button onClick={onClick} className={s.button}>
            <span>{id}</span>
            <FontAwesomeIcon icon={faCog} />
          </button>
        )}
      >
        <DropdownMenu
          alignment={columnIndex >= columns.length / 2 ? 'right' : 'left'}
        >
          {panel === 'root' && (
            <>
              <DropdownOption
                closeMenuOnClick={false}
                onClick={() => {
                  setPanel('rename');
                }}
              >
                <FontAwesomeIcon icon={faPen} /> Rename column
              </DropdownOption>
              <DropdownOption red onClick={onRemoveColumn.bind(null, id!)}>
                <FontAwesomeIcon icon={faTrashAlt} /> Remove column
              </DropdownOption>
              <DropdownSeparator />

              <DropdownOption
                onClick={onMoveColumn.bind(null, id!, false)}
                disabled={columnIndex === columns.length - 1}
              >
                <FontAwesomeIcon icon={faLongArrowAltRight} /> Move column to
                the right
              </DropdownOption>
              <DropdownOption
                onClick={onMoveColumn.bind(null, id!, true)}
                disabled={columnIndex === 0}
              >
                <FontAwesomeIcon icon={faLongArrowAltLeft} /> Move column to the
                left
              </DropdownOption>
              <DropdownSeparator />
              <DropdownOption onClick={onAddColumn.bind(null, id!, false)}>
                <FontAwesomeIcon icon={faLongArrowAltRight} /> Add column to the
                right
              </DropdownOption>
              <DropdownOption onClick={onAddColumn.bind(null, id!, true)}>
                <FontAwesomeIcon icon={faLongArrowAltLeft} /> Add column to the
                left
              </DropdownOption>
            </>
          )}
          {panel === 'rename' && (
            <>
              <form className={s.editForm} onSubmit={handleChangeName}>
                <TextField
                  id="newName"
                  name="newName"
                  label="Rename column:"
                  value={nameValue}
                  onChange={(newName) => setNameValue(newName)}
                />
                <Button type="submit" buttonSize="xxs" fullWidth>
                  Rename
                </Button>
              </form>
              <DropdownSeparator />
              <DropdownOption
                closeMenuOnClick={false}
                onClick={() => {
                  setPanel('root');
                }}
              >
                <FontAwesomeIcon icon={faTimes} /> Cancel
              </DropdownOption>
            </>
          )}
        </DropdownMenu>
      </Dropdown>
    </>
  );
}
