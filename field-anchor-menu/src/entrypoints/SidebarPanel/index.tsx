import { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FieldAnchorMenu = ({ ctx }: PropTypes) => {
  const allFieldsToShow = ctx.itemType.relationships.fields.data.map(
    ({ id }) => ctx.fields[id]!,
  ) as Array<any>;

  const topLevelStuff = [
    ...Object.values(ctx.fieldsets).filter(Boolean).filter(
      (fieldset) =>
        (fieldset as any).relationships.item_type.data.id === ctx.itemType.id,
    ),
    ...allFieldsToShow.filter((field) => !field.relationships.fieldset.data),
  ].sort((a: any, b: any) => a.attributes.position - b.attributes.position);

  return (
    <Canvas ctx={ctx}>
      {topLevelStuff.map((fieldOrFieldset: any) =>
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
                  (f: any) =>
                    f.relationships.fieldset.data?.id === fieldOrFieldset.id,
                )
                .map((fieldOrFieldset: any) => (
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
