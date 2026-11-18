import type { FilterCondition as BuilderCondition } from 'datocms-react-ui/FilterBuilder';
import type {
  FilterCondition,
  FilterField,
  FilterInput,
  FilterValue,
} from './types';
import { editorValueOf, filterValueOf } from './values';

function inputOf(
  fields: readonly FilterField[],
  condition: { field: string; operator: string },
): FilterInput | undefined {
  return fields.find((field) => field.key === condition.field)?.operators[
    condition.operator
  ];
}

/**
 * The conditions of the URL as the filter builder edits them. A condition of
 * a field that the list doesn't offer keeps its value: the builder hides it.
 */
export function builderConditionsOf(
  conditions: readonly FilterCondition[],
  fields: readonly FilterField[],
): BuilderCondition[] {
  return conditions.map((condition) => {
    const input = inputOf(fields, condition);
    return {
      field: condition.field,
      operator: condition.operator,
      value: input ? editorValueOf(condition.value, input) : condition.value,
    };
  });
}

/**
 * The conditions for the URL from the conditions of the builder. A condition
 * that the user didn't touch is the same object as before: it keeps its value
 * of the URL as it was, also the parts that its tile doesn't edit.
 */
export function filterConditionsOf(
  next: readonly BuilderCondition[],
  previous: {
    builder: readonly BuilderCondition[];
    filters: readonly FilterCondition[];
  },
  fields: readonly FilterField[],
): FilterCondition[] {
  return next.map((condition) => {
    const at = previous.builder.indexOf(condition);
    const kept = at === -1 ? undefined : previous.filters[at];
    if (kept) return kept;
    const input = inputOf(fields, condition);
    return {
      field: condition.field,
      operator: condition.operator,
      value: input
        ? filterValueOf(condition.value, input)
        : (condition.value as FilterValue | null),
    };
  });
}
