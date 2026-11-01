import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import TableList, {
  type TableListColumn,
  type TableListErrors,
} from 'datocms-react-ui/TableList';
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

const COLUMNS: TableListColumn<OptionRow>[] = [
  {
    id: 'preview',
    label: 'Preview',
    grow: 2,
    render: ({ item }) => (
      <span className={s.preview}>
        <Visualizer option={toOption(item)} />
      </span>
    ),
  },
  { id: 'name', field: 'name', label: 'Name', grow: 2 },
  { id: 'value', field: 'value', label: 'Value', grow: 2, code: true },
  {
    id: 'type',
    field: 'type',
    label: 'Type',
    grow: 3,
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
    label: 'Color or image URL',
    grow: 3,
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
