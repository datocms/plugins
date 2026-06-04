import { Button } from 'datocms-react-ui';
import { Field } from 'react-final-form';
import type {
  IdCollision,
  IdCollisionEntityType,
  IdReplacementIssue,
} from './buildConflicts';
import {
  idCollisionFieldPrefix,
  useResolutionStatusForIdCollision,
} from '../ResolutionsForm';

type Props = {
  collision: IdReplacementIssue;
  active?: boolean;
};

function entityTypeLabel(entityType: IdCollisionEntityType) {
  if (entityType === 'itemType') return 'model or block';
  if (entityType === 'fieldset') return 'fieldset';
  if (entityType === 'plugin') return 'plugin';
  return 'field';
}

function describeProjectTarget(collision: IdCollision) {
  if (
    collision.entityType === 'field' ||
    collision.entityType === 'fieldset'
  ) {
    return `${collision.projectLabel} in ${collision.projectParentItemType.attributes.name}`;
  }

  return collision.projectLabel;
}

function isOccupiedIssue(collision: IdReplacementIssue): collision is IdCollision {
  return collision.reason === 'occupied';
}

export function IdCollisionFallback({
  collision,
  active = true,
}: Props) {
  const status = useResolutionStatusForIdCollision(
    collision.entityType,
    collision.exportId,
  );
  const fieldPrefix = idCollisionFieldPrefix(
    collision.entityType,
    collision.exportId,
  );

  if (!active) {
    return null;
  }

  const confirmed = status?.values.strategy === 'generateReplacement';
  const hasError = Boolean(status?.invalid);

  return (
    <div
      className={`id-collision${confirmed ? ' id-collision--resolved' : ''}${
        hasError ? ' id-collision--invalid' : ''
      }`}
    >
      <div className="id-collision__body">
        <div className="id-collision__title">
          {isOccupiedIssue(collision) ? (
            <>
              The exported {entityTypeLabel(collision.entityType)} ID{' '}
              <code>{collision.exportId}</code> is already used.
            </>
          ) : (
            <>
              The exported {entityTypeLabel(collision.entityType)} ID{' '}
              <code>{collision.exportId}</code> is a legacy ID.
            </>
          )}
        </div>
        <div className="id-collision__text">
          {isOccupiedIssue(collision) ? (
            <>
              It is used by <strong>{describeProjectTarget(collision)}</strong>.
            </>
          ) : (
            <>
              Legacy IDs cannot be used to import with consistent IDs. This
              entity will need a new random ID.
            </>
          )}
        </div>
      </div>
      <Field name={`${fieldPrefix}.strategy`}>
        {({ input }) => (
          <Button
            type="button"
            buttonSize="s"
            buttonType={confirmed ? 'muted' : 'primary'}
            onClick={() => input.onChange('generateReplacement')}
          >
            {confirmed ? 'Replacement ID confirmed' : 'Generate replacement ID'}
          </Button>
        )}
      </Field>
    </div>
  );
}
