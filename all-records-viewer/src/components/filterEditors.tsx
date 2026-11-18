import DateInput from 'datocms-react-ui/DateInput';
import DateTimeInput from 'datocms-react-ui/DateTimeInput';
import type {
  FilterField as BuilderField,
  FilterEditor,
  FilterEditorRenderProps,
  FilterSelectOption,
} from 'datocms-react-ui/FilterBuilder';
import SelectInput from 'datocms-react-ui/SelectInput';
import { localeName, OPERATOR_LABELS } from '../filters/filters';
import type { FilterField, FilterInput } from '../filters/types';
import type { CreatorOption } from '../filters/useCreatorOptions';
import { NEAR_PARTS, valueKind } from '../filters/values';

export type Creators = {
  options: readonly CreatorOption[];
  loading: boolean;
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  updated: 'Unpublished changes',
  published: 'Published',
};

const BOOLEAN_OPTIONS: FilterSelectOption[] = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

const NEAR_LABELS = {
  latitude: 'Latitude',
  longitude: 'Longitude',
  radius: 'Radius (m)',
} as const;

function placeholderOf(input: FilterInput): string {
  if (input.type === 'object') return 'Text';
  const many = input.array;
  switch (input.inputType) {
    case 'item_id':
      return many ? 'Record IDs, comma-separated' : 'Record ID';
    case 'upload_id':
      return many ? 'Asset IDs, comma-separated' : 'Asset ID';
    case 'integer':
    case 'float':
      return 'Number';
    default:
      return many ? 'Values, comma-separated' : 'Text';
  }
}

function DateEditor({
  value,
  onChange,
  disabled,
  readOnly,
  ariaLabel,
}: FilterEditorRenderProps) {
  return (
    <DateInput
      variant="filter"
      ariaLabel={ariaLabel}
      value={typeof value === 'string' ? value : null}
      onChange={onChange}
      disabled={disabled}
      readOnly={readOnly}
    />
  );
}

function DateTimeEditor({
  value,
  onChange,
  disabled,
  readOnly,
  ariaLabel,
}: FilterEditorRenderProps) {
  return (
    <DateTimeInput
      variant="filter"
      ariaLabel={ariaLabel}
      value={typeof value === 'string' ? value : null}
      onChange={onChange}
      disabled={disabled}
      readOnly={readOnly}
      seconds={false}
      timezoneSelect="whenDifferent"
    />
  );
}

// The creators are objects in the CMA ({ type, id }): the tile picks their
// keys ("user:123"), from a list that loads once a tile needs it
function CreatorEditor({
  value,
  onChange,
  disabled,
  readOnly,
  ariaLabel,
  multiple,
  creators,
}: FilterEditorRenderProps & { multiple: boolean; creators: Creators }) {
  const known = (key: string) =>
    creators.options.find((option) => option.value === key) ?? {
      value: key,
      label: key,
    };
  const common = {
    'aria-label': ariaLabel,
    autosize: true,
    variant: 'filter' as const,
    clearable: false,
    loading: creators.loading,
    options: creators.options,
    acceptValueNotIncludedInOptions: known,
    disabled,
    readOnly,
  };

  return multiple ? (
    <SelectInput
      {...common}
      multiple
      value={Array.isArray(value) ? value.map(String) : []}
      onChange={(next) => onChange(next ?? [])}
    />
  ) : (
    <SelectInput
      {...common}
      value={typeof value === 'string' ? value : null}
      onChange={(next) => onChange(next)}
    />
  );
}

function editorOf(
  input: FilterInput,
  locales: readonly string[],
  creators: Creators,
): FilterEditor {
  const multiple = Boolean(input.array);
  switch (valueKind(input)) {
    case 'boolean':
      // "is not null" filters nothing without a value: it starts at true
      return { type: 'select', options: BOOLEAN_OPTIONS, defaultValue: 'true' };
    case 'enum':
      return {
        type: 'select',
        multiple,
        options: (input.type === 'scalar' ? (input.values ?? []) : []).map(
          (key) => ({ value: key, label: STATUS_LABELS[key] ?? key }),
        ),
      };
    case 'locale':
      return {
        type: 'select',
        multiple,
        options: locales.map((code) => ({
          value: code,
          label: localeName(code),
        })),
      };
    case 'creator':
      return {
        type: 'custom',
        kind: 'creator',
        multiple,
        defaultValue: multiple ? [] : null,
        render: (props) => (
          <CreatorEditor {...props} multiple={multiple} creators={creators} />
        ),
      };
    case 'matches':
      return { type: 'text', placeholder: placeholderOf(input) };
    case 'near':
      return {
        type: 'group',
        arguments: NEAR_PARTS.map((part) => ({
          id: part,
          label: NEAR_LABELS[part],
          editor: { type: 'number' },
        })),
      };
    case 'date':
      return {
        type: 'custom',
        kind: 'date',
        defaultValue: null,
        render: (props) => <DateEditor {...props} />,
      };
    case 'date_time':
      return {
        type: 'custom',
        kind: 'date_time',
        defaultValue: null,
        render: (props) => <DateTimeEditor {...props} />,
      };
    case 'number':
      return { type: 'number', placeholder: placeholderOf(input) };
    default:
      return {
        type: multiple ? 'list' : 'text',
        placeholder: placeholderOf(input),
      };
  }
}

/** The fields of the filter builder, with the editor of each operator */
export function builderFieldsOf(
  fields: readonly FilterField[],
  locales: readonly string[],
  creators: Creators,
): BuilderField[] {
  return fields.map((field) => ({
    id: field.key,
    label: field.label,
    operators: Object.entries(field.operators).map(([id, input]) => ({
      id,
      label: OPERATOR_LABELS[id] ?? id,
      editor: editorOf(input, locales, creators),
    })),
  }));
}
