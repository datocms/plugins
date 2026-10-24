import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import IdText from 'datocms-react-ui/IdText';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import type { ReactElement } from 'react';
import { Field } from 'react-final-form';
import { idCollisionFieldPrefix } from '../ResolutionsForm';
import type { IdReplacementIssue } from './buildConflicts';

type Props = {
  collision: IdReplacementIssue;
  /** The entity will be created: its IDs need a decision */
  active?: boolean;
};

/** The name of the switch: the entity itself, or its field or fieldset */
function switchLabel(collision: IdReplacementIssue) {
  if (collision.entityType === 'plugin') {
    return 'New ID for this plugin';
  }
  if (collision.entityType === 'itemType') {
    return collision.exportEntity.attributes.modular_block
      ? 'New ID for this block'
      : 'New ID for this model';
  }
  return `New ID for “${collision.exportLabel}”`;
}

/** Why the exported ID can't be kept */
function describeIssue(collision: IdReplacementIssue): ReactElement {
  if (collision.reason === 'legacy') {
    return (
      <>
        <IdText id={collision.exportId} /> is a legacy ID, which the import
        can't keep.
      </>
    );
  }

  const user =
    collision.entityType === 'field' || collision.entityType === 'fieldset'
      ? `${collision.projectLabel} in ${collision.projectParentItemType.attributes.name}`
      : collision.projectLabel;

  return (
    <>
      The ID <IdText id={collision.exportId} /> is already used by “{user}”.
    </>
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
