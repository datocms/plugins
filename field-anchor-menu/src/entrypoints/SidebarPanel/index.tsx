import type { SchemaTypes } from '@datocms/cma-client';
import type { Field, RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import EntityRow from 'datocms-react-ui/EntityRow';
import IconAvatar from 'datocms-react-ui/IconAvatar';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import { useId } from 'react';
import { fieldTypeIcon } from '../../utils/fieldTypes';
import s from './styles.module.css';

type Fieldset = SchemaTypes.Fieldset;

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

type FieldOrFieldset = Field | Fieldset;

function isField(item: FieldOrFieldset): item is Field {
  return item.type === 'field';
}

function isFieldset(item: FieldOrFieldset): item is Fieldset {
  return item.type === 'fieldset';
}

function getPosition(item: FieldOrFieldset): number {
  return item.attributes.position;
}

const FieldAnchorMenu = ({ ctx }: PropTypes) => {
  const idPrefix = useId();

  const allFieldsToShow = ctx.itemType.relationships.fields.data
    .map(({ id }) => ctx.fields[id])
    .filter((field): field is Field => field !== undefined);

  const topLevelStuff: FieldOrFieldset[] = [
    ...Object.values(ctx.fieldsets)
      .filter((fieldset): fieldset is Fieldset => fieldset !== undefined)
      .filter(
        (fieldset) =>
          fieldset.relationships.item_type.data.id === ctx.itemType.id,
      ),
    ...allFieldsToShow.filter((field) => !field.relationships.fieldset.data),
  ].sort((a, b) => getPosition(a) - getPosition(b));

  // Consecutive top-level fields share one list, with the gap between two
  // rows
  const segments: (Field[] | Fieldset)[] = [];

  for (const item of topLevelStuff) {
    const last = segments[segments.length - 1];

    if (isField(item) && Array.isArray(last)) {
      last.push(item);
    } else if (isField(item)) {
      segments.push([item]);
    } else if (isFieldset(item)) {
      segments.push(item);
    }
  }

  const fieldsOf = (fieldset: Fieldset) =>
    allFieldsToShow.filter(
      (field) => field.relationships.fieldset.data?.id === fieldset.id,
    );

  // A fieldset with no fields has nothing to scroll to
  const visibleSegments = segments.filter(
    (segment) => Array.isArray(segment) || fieldsOf(segment).length > 0,
  );

  // Each field shows the icon of its type, on the color of its group, as in
  // the schema of the model
  const renderField = (field: Field) => {
    const { icon, surface } = fieldTypeIcon(field);
    return (
      <RowList.Item
        key={field.id}
        onClick={() => {
          ctx.scrollToField(
            `${field.attributes.api_key}${
              field.attributes.localized ? ctx.locale : ''
            }`,
          );
        }}
      >
        <EntityRow
          layout="inline"
          image={<IconAvatar icon={icon} size={20} surface={surface} />}
          title={field.attributes.label}
        />
      </RowList.Item>
    );
  };

  return (
    <Canvas ctx={ctx}>
      {visibleSegments.length === 0 ? (
        <SidebarPanel.Blank message="This model has no fields" />
      ) : (
        <div className={s.segments}>
          {visibleSegments.map((segment) =>
            Array.isArray(segment) ? (
              <RowList key={segment[0].id} density="compact">
                {segment.map(renderField)}
              </RowList>
            ) : (
              // A fieldset is a box with its title, around its fields
              <div
                key={segment.id}
                role="group"
                aria-labelledby={`${idPrefix}${segment.id}`}
                className={s.fieldset}
              >
                <div
                  id={`${idPrefix}${segment.id}`}
                  className={s.fieldsetTitle}
                >
                  {segment.attributes.title}
                </div>
                <RowList density="compact">
                  {fieldsOf(segment).map(renderField)}
                </RowList>
              </div>
            ),
          )}
        </div>
      )}
    </Canvas>
  );
};

export default FieldAnchorMenu;
