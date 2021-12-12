import { connect, RenderItemFormSidebarPanelCtx } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import React from "react";
import ReactDOM from "react-dom";
import FieldAnchorMenu from "./entrypoints/FieldAnchorMenu";

connect({
  itemFormSidebarPanels() {
    return [
      {
        id: "fieldAnchorMenu",
        label: "Field Anchor Menu",
        startOpen: true,
        placement: ["after", "info"],
      },
    ];
  },
  renderItemFormSidebarPanel(
    sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx
  ) {
    ReactDOM.render(
      <React.StrictMode>
        <FieldAnchorMenu ctx={ctx} />
      </React.StrictMode>,
      document.getElementById("root")
    );
  },
});
