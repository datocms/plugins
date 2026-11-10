import AutosizeInput from 'datocms-react-ui/AutosizeInput';
import Button from 'datocms-react-ui/Button';
import SelectInput from 'datocms-react-ui/SelectInput';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localeName, OPERATOR_LABELS } from '../filters/filters';
import type {
  FilterCondition,
  FilterField,
  FilterInput,
  FilterValue,
} from '../filters/types';
import type { CreatorOption } from '../filters/useCreatorOptions';
import {
  creatorKeys,
  creatorOfKey,
  defaultValue,
  nearValue,
  textOf,
  type ValueKind,
  valueKind,
  valueOfText,
} from '../filters/values';
import { CloseIcon } from '../icons';
import { useDebouncedValue } from '../state/useDebouncedValue';
import s from './FilterBar.module.css';

type Option = { value: string; label: string };

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  updated: 'Unpublished changes',
  published: 'Published',
};

const BOOLEAN_OPTIONS: readonly Option[] = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

function ignore(): void {}

/** The first operator of a field, and the value a new tile starts with */
export function newCondition(field: FilterField): FilterCondition {
  const [operator, input] = Object.entries(field.operators)[0] ?? ['eq'];
  return {
    field: field.key,
    operator,
    value: input ? defaultValue(input) : null,
  };
}

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

// A text value: it reaches the list a moment after the user stops typing
function TextValue({
  value,
  input,
  label,
  type = 'text',
  onChange,
}: {
  value: FilterValue | null;
  input: FilterInput;
  label: string;
  type?: 'text' | 'date' | 'datetime-local';
  onChange: (value: FilterValue | null) => void;
}) {
  const [text, setText] = useState(() => textOf(value, input));
  const debounced = useDebouncedValue(text, 500);
  const committed = useRef(text);
  const placeholder = type === 'text' ? placeholderOf(input) : '';

  useEffect(() => {
    if (debounced !== text || debounced === committed.current) return;
    committed.current = debounced;
    onChange(valueOfText(debounced, input));
  }, [debounced, input, onChange, text]);

  // A date input has the width of its own control
  if (type !== 'text') {
    return (
      <input
        className={`${s.input} ${s.dateInput}`}
        type={type}
        // A year of four digits: the input moves on to the next part
        max={type === 'date' ? '9999-12-31' : '9999-12-31T23:59'}
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    );
  }

  return (
    <AutosizeInput text={text} placeholder={placeholder} className={s.autosize}>
      <input
        className={s.input}
        type={type}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        inputMode={
          input.type === 'scalar' && input.inputType === 'integer'
            ? 'numeric'
            : input.type === 'scalar' && input.inputType === 'float'
              ? 'decimal'
              : undefined
        }
        onChange={(event) => setText(event.target.value)}
      />
    </AutosizeInput>
  );
}

// The point and the radius of a "near" tile
function NearValue({
  value,
  onChange,
}: {
  value: FilterValue | null;
  onChange: (value: FilterValue | null) => void;
}) {
  const initial =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const [parts, setParts] = useState(() => ({
    latitude: 'latitude' in initial ? String(initial.latitude) : '',
    longitude: 'longitude' in initial ? String(initial.longitude) : '',
    radius: 'radius' in initial ? String(initial.radius) : '',
  }));
  const debounced = useDebouncedValue(parts, 500);
  const committed = useRef(parts);

  useEffect(() => {
    if (debounced !== parts || debounced === committed.current) return;
    committed.current = debounced;
    onChange(
      nearValue(debounced.latitude, debounced.longitude, debounced.radius),
    );
  }, [debounced, onChange, parts]);

  return (
    <>
      {(['latitude', 'longitude', 'radius'] as const).map((part) => (
        <AutosizeInput
          key={part}
          text={parts[part]}
          placeholder={part}
          className={s.autosize}
        >
          <input
            className={s.input}
            aria-label={part}
            placeholder={part}
            inputMode="decimal"
            value={parts[part]}
            onChange={(event) =>
              setParts((current) => ({
                ...current,
                [part]: event.target.value,
              }))
            }
          />
        </AutosizeInput>
      ))}
    </>
  );
}

// A value that the user picks from a list
function ChoiceValue({
  options,
  multiple,
  keys,
  label,
  loading,
  onChange,
}: {
  options: readonly Option[];
  multiple: boolean;
  keys: readonly string[];
  label: string;
  loading?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const known = (key: string) =>
    options.find((option) => option.value === key) ?? {
      value: key,
      label: key,
    };

  return multiple ? (
    <SelectInput
      aria-label={label}
      autosize
      variant="filter"
      clearable={false}
      multiple
      loading={loading}
      placeholder="Select"
      options={options}
      value={[...keys]}
      acceptValueNotIncludedInOptions={known}
      onChange={(value) => onChange(value ?? [])}
      onBlur={ignore}
    />
  ) : (
    <SelectInput
      aria-label={label}
      autosize
      variant="filter"
      clearable={false}
      loading={loading}
      placeholder="Select"
      options={options}
      value={keys[0] ?? null}
      acceptValueNotIncludedInOptions={known}
      onChange={(value) => onChange(value ? [value] : [])}
      onBlur={ignore}
    />
  );
}

function stringsOf(value: FilterValue | null): string[] {
  const entries = Array.isArray(value) ? value : value === null ? [] : [value];
  return entries.map((entry) => String(entry));
}

function ValueControl({
  kind,
  input,
  value,
  label,
  locales,
  creators,
  onChange,
}: {
  kind: ValueKind;
  input: FilterInput;
  value: FilterValue | null;
  label: string;
  locales: readonly string[];
  creators: { options: readonly CreatorOption[]; loading: boolean };
  onChange: (value: FilterValue | null) => void;
}) {
  const multiple = Boolean(input.array);
  const pick = (keys: string[], map: (key: string) => FilterValue) =>
    onChange(
      keys.length === 0
        ? null
        : multiple
          ? keys.map(map)
          : map(keys[0] as string),
    );

  switch (kind) {
    case 'boolean':
      return (
        <ChoiceValue
          label={label}
          multiple={false}
          options={BOOLEAN_OPTIONS}
          keys={stringsOf(value)}
          onChange={(keys) => pick(keys, (key) => key === 'true')}
        />
      );
    case 'enum':
      return (
        <ChoiceValue
          label={label}
          multiple={multiple}
          options={(input.type === 'scalar' ? (input.values ?? []) : []).map(
            (key) => ({ value: key, label: STATUS_LABELS[key] ?? key }),
          )}
          keys={stringsOf(value)}
          onChange={(keys) => pick(keys, (key) => key)}
        />
      );
    case 'locale':
      return (
        <ChoiceValue
          label={label}
          multiple={multiple}
          options={locales.map((code) => ({
            value: code,
            label: localeName(code),
          }))}
          keys={stringsOf(value)}
          onChange={(keys) => pick(keys, (key) => key)}
        />
      );
    case 'creator':
      return (
        <ChoiceValue
          label={label}
          multiple={multiple}
          options={creators.options}
          loading={creators.loading}
          keys={creatorKeys(value)}
          onChange={(keys) => pick(keys, creatorOfKey)}
        />
      );
    case 'near':
      return <NearValue value={value} onChange={onChange} />;
    case 'date':
      return (
        <TextValue
          label={label}
          type="date"
          input={input}
          value={value}
          onChange={onChange}
        />
      );
    case 'date_time':
      return (
        <TextValue
          label={label}
          type="datetime-local"
          input={input}
          value={value}
          onChange={onChange}
        />
      );
    default:
      return (
        <TextValue
          label={label}
          input={input}
          value={value}
          onChange={onChange}
        />
      );
  }
}

/**
 * One filter, as the record list of the dashboard draws it: the field, the
 * operator and the value in one box, with a ✕ that removes it. A change of
 * the field or the operator starts the value again.
 */
export function FilterTile({
  condition,
  fields,
  locales,
  creators,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  fields: readonly FilterField[];
  locales: readonly string[];
  creators: { options: readonly CreatorOption[]; loading: boolean };
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}) {
  const field = fields.find((entry) => entry.key === condition.field);
  const input = field?.operators[condition.operator];
  const fieldOptions = fields.map((entry) => ({
    value: entry.key,
    label: entry.label,
  }));
  const operatorOptions = Object.keys(field?.operators ?? {}).map((key) => ({
    value: key,
    label: OPERATOR_LABELS[key] ?? key,
  }));
  const label = `${field?.label ?? condition.field} ${OPERATOR_LABELS[condition.operator] ?? condition.operator}`;
  // The value control keeps one callback: its debounce must not restart
  const latest = useRef({ condition, onChange });
  latest.current = { condition, onChange };
  const onValueChange = useCallback(
    (value: FilterValue | null) =>
      latest.current.onChange({ ...latest.current.condition, value }),
    [],
  );

  return (
    <div className={s.tile}>
      <SelectInput
        aria-label="Field"
        autosize
        variant="filter-field"
        clearable={false}
        options={fieldOptions}
        value={condition.field}
        acceptValueNotIncludedInOptions={(key) => ({ value: key, label: key })}
        onChange={(key) => {
          const next = fields.find((entry) => entry.key === key);
          if (next) onChange(newCondition(next));
        }}
        onBlur={ignore}
      />
      <SelectInput
        aria-label="Operator"
        autosize
        variant="filter"
        clearable={false}
        options={operatorOptions}
        value={condition.operator}
        acceptValueNotIncludedInOptions={(key) => ({ value: key, label: key })}
        onChange={(operator) => {
          const nextInput = operator ? field?.operators[operator] : undefined;
          if (!operator || !nextInput) return;
          onChange({
            field: condition.field,
            operator,
            value: defaultValue(nextInput),
          });
        }}
        onBlur={ignore}
      />
      {input && (
        <ValueControl
          // A new field or operator starts the value from scratch
          key={`${condition.field}:${condition.operator}`}
          kind={valueKind(input)}
          input={input}
          value={condition.value}
          label={label}
          locales={locales}
          creators={creators}
          onChange={onValueChange}
        />
      )}
      <Button
        tone="ghost"
        size="micro"
        iconOnly
        icon={CloseIcon}
        label="Remove filter"
        onClick={onRemove}
      />
    </div>
  );
}
