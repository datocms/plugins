import { RenderItemFormSidebarPanelCtx } from "datocms-plugin-sdk";
import { Canvas } from "datocms-react-ui";
import styles from "./FieldAnchorMenu.module.css";

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FieldAnchorMenu = ({ ctx }: PropTypes) => {
  return (
    <Canvas ctx={ctx}>
      <ul>
        {Object.keys(ctx.fields).map((key) => (
          <li
            className={styles.link}
            onClick={() => {
              ctx.scrollToField(ctx.fields[key]?.attributes.api_key!);
            }}
            key={key}
          >
            {ctx.fields[key]?.attributes.label}
          </li>
        ))}
      </ul>
    </Canvas>
  );
};

export default FieldAnchorMenu;
