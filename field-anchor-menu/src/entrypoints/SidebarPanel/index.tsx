import { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Fieldset } from 'datocms-plugin-sdk/dist/types/SiteApiSchema';
import { Canvas } from 'datocms-react-ui';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FieldAnchorMenu = ({ ctx }: PropTypes) => {
  const allFieldsToShow = ctx.itemType.relationships.fields.data.map(
    ({ id }) => ctx.fields[id]!,
  );

  const topLevelStuff = [
    ...(Object.values(ctx.fieldsets) as Fieldset[]).filter(
      (fieldset) =>
        fieldset.relationships.item_type.data.id === ctx.itemType.id,
    ),
    ...allFieldsToShow.filter((field) => !field.relationships.fieldset.data),
  ].sort((a, b) => a.attributes.position - b.attributes.position);

  return (
    <Canvas ctx={ctx}>
      {topLevelStuff.map((fieldOrFieldset) =>
        fieldOrFieldset.type === 'field' ? (
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
        ) : (
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
                .map((fieldOrFieldset) => (
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
                ))}
            </div>
          </div>
        ),
      )}
    </Canvas>
  );
};

export default FieldAnchorMenu;
