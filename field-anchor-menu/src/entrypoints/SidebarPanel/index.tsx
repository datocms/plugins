import type { SchemaTypes } from '@datocms/cma-client';
import type { Field, RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './styles.module.css';

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

  return (
    <Canvas ctx={ctx}>
      {topLevelStuff.map((fieldOrFieldset) => {
        if (isField(fieldOrFieldset)) {
          return (
            <div
              className={styles.link}
              onClick={() => {
                ctx.scrollToField(
                  `${fieldOrFieldset.attributes.api_key}${
                    fieldOrFieldset.attributes.localized ? ctx.locale : ''
                  }`,
                );
              }}
              key={fieldOrFieldset.id}
            >
              {fieldOrFieldset.attributes.label}
            </div>
          );
        }

        if (isFieldset(fieldOrFieldset)) {
          return (
            <div className={styles.group} key={fieldOrFieldset.id}>
              <div className={styles.groupName}>
                {fieldOrFieldset.attributes.title}
              </div>
              <div className={styles.groupChildren}>
                {allFieldsToShow
                  .filter(
                    (f) =>
                      f.relationships.fieldset.data?.id === fieldOrFieldset.id,
                  )
                  .map((field) => (
                    <div
                      className={styles.link}
                      onClick={() => {
                        ctx.scrollToField(
                          `${field.attributes.api_key}${
                            field.attributes.localized ? ctx.locale : ''
                          }`,
                        );
                      }}
                      key={field.id}
                    >
                      {field.attributes.label}
                    </div>
                  ))}
              </div>
            </div>
          );
        }

        return null;
      })}
    </Canvas>
  );
};

export default FieldAnchorMenu;
