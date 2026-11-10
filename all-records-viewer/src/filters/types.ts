export type ScalarInputType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'float'
  | 'date'
  | 'date_time'
  | 'item_id'
  | 'upload_id'
  | 'enum'
  | 'locale';

/** The value of an operator: one value, or a list of them with `array` */
export type ScalarInput = {
  type: 'scalar';
  inputType: ScalarInputType;
  array?: boolean;
  values?: readonly string[];
};

/** The value of an operator that has named parts (a pattern, a point) */
export type ObjectInput = {
  type: 'object';
  arguments: Readonly<Record<string, ScalarInput>>;
  array?: boolean;
};

export type FilterInput = ScalarInput | ObjectInput;

/** The operators of a field, with the input of each one */
export type FilterOperators = Readonly<Record<string, FilterInput>>;

export type FilterSchema = {
  meta: Readonly<Record<string, FilterOperators>>;
  fieldTypes: Readonly<Record<string, FilterOperators>>;
};

/** A value as the CMA takes it in `filter[fields]` */
export type FilterValue =
  | string
  | number
  | boolean
  | readonly FilterValue[]
  | { readonly [key: string]: FilterValue };

/**
 * One tile of the filter: a field, an operator and the value. The value is
 * `null` while the user has not given it: the tile shows, and the list does
 * not use it yet.
 */
export type FilterCondition = {
  field: string;
  operator: string;
  value: FilterValue | null;
};

/** A field that the user can filter by, with the operators it has */
export type FilterField = {
  key: string;
  label: string;
  operators: FilterOperators;
};
