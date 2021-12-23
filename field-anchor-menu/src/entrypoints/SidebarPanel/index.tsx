import { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FieldAnchorMenu = ({ ctx }: PropTypes) => {
  const allFieldsToShow = ctx.itemType.relationships.fields.data.map(
    ({ id }) => ctx.fields[id]!,
  );

  return (
    <Canvas ctx={ctx}>
      {allFieldsToShow.map((field) => (
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
    </Canvas>
  );
};

export default FieldAnchorMenu;
