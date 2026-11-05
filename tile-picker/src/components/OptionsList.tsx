import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import TableList, {
  type TableListCell,
  type TableListColumn,
  type TableListErrors,
} from 'datocms-react-ui/TableList';
import { useLayoutEffect, useRef, useState } from 'react';
import s from '../lib/styles.module.css';
import type { Option } from '../lib/types';
import Visualizer from './visualizers/visualizer';

/** An option while it is edited: one source cell holds its color or URL */
export type OptionRow = {
  name: string;
  value: string;
  type: 'color' | 'image';
  source: string;
};

export const toRow = (option: Option): OptionRow => ({
  name: option.name,
  value: option.value,
  type: option.type,
  source: option.type === 'image' ? option.url : option.color,
});

// The stored option keeps only the key of its type
export const toOption = ({ name, value, type, source }: OptionRow): Option =>
  type === 'image'
    ? { name, type: 'image', url: source, value }
    : { name, type: 'color', color: source, value };

/** Name, value and source are required: an empty text is an error */
export const optionErrors = (rows: OptionRow[]): TableListErrors =>
  rows.map((row) => ({
    name: row.name.trim() ? undefined : 'Enter a name',
    value: row.value.trim() ? undefined : 'Enter a value',
    source: row.source.trim() ? undefined : 'Enter a color or an image URL',
  }));

export const hasOptionErrors = (rows: OptionRow[]) =>
  rows.some(
    (row) => !row.name.trim() || !row.value.trim() || !row.source.trim(),
  );

const TYPES = [
  { value: 'color', label: 'Color' },
  { value: 'image', label: 'Image' },
];

const newOption = (): OptionRow => ({
  name: '',
  value: '',
  type: 'color',
  source: '',
});

/**
 * The name of the file of an image URL: the end of its path. The start of
 * the URLs is the same for all the images, the end tells them apart. The
 * DatoCMS asset CDN puts the time of the upload before the name of the file
 * ("1699999999-hero.png"): the name leaves it out.
 */
function fileName(url: string) {
  if (url.startsWith('data:')) return url;
  const name = url.split(/[?#]/)[0]?.split('/').filter(Boolean).pop();
  if (!name) return url;
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {}
  return decoded.replace(/^\d{10,}-(?=.)/, '');
}

/**
 * The color or the image of an option: its preview, then its text. Out of
 * the focus, an image shows the name of its file and the whole URL in the
 * tooltip. In the focus, the input holds the whole URL.
 */
function SourceCell({
  item,
  value,
  onChange,
  onBlur,
  inputProps,
}: TableListCell<OptionRow>) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const source = String(value ?? '');
  const isImage = item.type === 'image';

  // The input keeps the scroll of the whole URL: the file name starts at the
  // left again
  useLayoutEffect(() => {
    if (!editing && input.current) input.current.scrollLeft = 0;
  }, [editing]);

  return (
    <>
      <span className={s.preview}>
        <Visualizer option={toOption(item)} />
      </span>
      <input
        ref={input}
        type="text"
        {...inputProps}
        className={`${inputProps.className} ${s.sourceInput}`}
        value={editing || !isImage ? source : fileName(source)}
        title={isImage && source ? source : undefined}
        placeholder={isImage ? 'https://example.com/tile.png' : '#3b82f6'}
        onFocus={() => setEditing(true)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          setEditing(false);
          onBlur();
        }}
      />
    </>
  );
}

const COLUMNS: TableListColumn<OptionRow>[] = [
  { id: 'name', field: 'name', label: 'Name', grow: 6 },
  { id: 'value', field: 'value', label: 'Value', grow: 6, code: true },
  {
    id: 'type',
    field: 'type',
    label: 'Type',
    grow: 5,
    // The class of the cell input is for a text input: the select does not
    // take it
    render: ({
      index,
      value,
      onChange,
      onBlur,
      inputProps: { className: _, ...inputProps },
    }) => (
      <SelectInput
        {...inputProps}
        name={`type-${index}`}
        value={value as string}
        onChange={onChange}
        onBlur={onBlur}
        options={TYPES}
        clearable={false}
        variant="embedded"
        classNamePrefix="TableList__select"
      />
    ),
  },
  {
    id: 'source',
    field: 'source',
    label: 'Color or image',
    grow: 8,
    render: (cell) => <SourceCell {...cell} />,
  },
];

type Props = {
  value: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
};

export default function OptionsList({ value, onChange }: Props) {
  return (
    <FieldWrapper
      label="Options"
      hint="The value is what the field stores. A color is any CSS color, like green."
    >
      <TableList<OptionRow>
        value={value}
        onChange={onChange}
        errors={optionErrors(value)}
        // A missing value shows at once, as it always did
        touched={true}
        columns={COLUMNS}
        emptyMessage="No options yet"
        add={{ label: 'Add option', newItem: newOption }}
      />
    </FieldWrapper>
  );
}
