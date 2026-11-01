import type { SchemaTypes } from '@datocms/cma-client';
import type { Field, RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import EntityRow from 'datocms-react-ui/EntityRow';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import { type CSSProperties, useId } from 'react';
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

  // Consecutive top-level fields share one list: a list per field would put
  // the inset of a list between them, not the gap between two rows
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

  const renderField = (field: Field) => (
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
      <EntityRow layout="row" multilineTitle title={field.attributes.label} />
    </RowList.Item>
  );

  const [, right, , left] = ctx.bodyPadding;
  const insets = {
    '--frame-inset-left': `${left}px`,
    '--frame-inset-right': `${right}px`,
  } as CSSProperties;

  return (
    <Canvas ctx={ctx}>
      {segments.length === 0 ? (
        <SidebarPanel.Blank message="This model has no fields" />
      ) : (
        <div className={s.rows} style={insets}>
          {segments.map((segment) =>
            Array.isArray(segment) ? (
              <RowList key={segment[0].id}>{segment.map(renderField)}</RowList>
            ) : (
              <div
                key={segment.id}
                role="group"
                aria-labelledby={`${idPrefix}${segment.id}`}
              >
                <div id={`${idPrefix}${segment.id}`} className={s.groupTitle}>
                  {segment.attributes.title}
                </div>
                <RowList>
                  {allFieldsToShow
                    .filter(
                      (field) =>
                        field.relationships.fieldset.data?.id === segment.id,
                    )
                    .map(renderField)}
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
