import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import get from 'lodash-es/get';
import { Field, useFormState } from 'react-final-form';
import { idCollisionFieldPrefix } from '../ResolutionsForm';
import type { IdReplacementIssue } from './buildConflicts';

type Props = {
  collision: IdReplacementIssue;
  /** The entity will be created: its IDs need a decision */
  active?: boolean;
};

/** The name of the switch: the entity itself, or its field or fieldset */
function switchLabel(collision: IdReplacementIssue) {
  if (
    collision.entityType === 'plugin' ||
    collision.entityType === 'itemType'
  ) {
    return 'Gets a new ID';
  }
  return `“${collision.exportLabel}” gets a new ID`;
}

/**
 * Why the exported ID can't be kept, in words: the ID itself means nothing
 * to the user. It stays once the switch is on: the label tells the rest.
 */
function describeIssue(collision: IdReplacementIssue) {
  if (collision.reason === 'legacy') {
    return "This ID is in an old format the import can't keep.";
  }
  if (collision.entityType === 'field' || collision.entityType === 'fieldset') {
    return `“${collision.projectLabel}” in “${collision.projectParentItemType.attributes.name}” already uses this ID.`;
  }
  return `“${collision.projectLabel}” already uses this ID.`;
}

/** A switch of these is still off: the import can't keep that ID */
export function usePendingIdIssue(issues: IdReplacementIssue[]) {
  const { values } = useFormState({ subscription: { values: true } });
  return issues.some(
    (issue) =>
      get(values, [
        idCollisionFieldPrefix(issue.entityType, issue.exportId),
        'strategy',
      ]) !== 'generateReplacement',
  );
}

/**
 * A row of a SwitchList for an exported ID that the project can't take: the
 * switch gives the entity a new ID. It shows only while the entity will be
 * created (not reused or skipped).
 */
export function IdCollisionFallback({ collision, active = true }: Props) {
  if (!active) {
    return null;
  }

  const fieldPrefix = idCollisionFieldPrefix(
    collision.entityType,
    collision.exportId,
  );

  return (
    <Field
      name={`${fieldPrefix}.strategy`}
      subscription={{ value: true, error: true, touched: true }}
    >
      {({ input, meta }) => (
        <FieldWrapper
          hint={describeIssue(collision)}
          error={meta.touched ? meta.error : undefined}
        >
          <SwitchInput
            label={switchLabel(collision)}
            value={input.value === 'generateReplacement'}
            onChange={(on) => input.onChange(on ? 'generateReplacement' : null)}
            onBlur={() => input.onBlur()}
          />
        </FieldWrapper>
      )}
    </Field>
  );
}
