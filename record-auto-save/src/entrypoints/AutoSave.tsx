import { RenderItemFormOutletCtx } from "datocms-plugin-sdk";
import { useEffect } from "react";
import { PluginParametersType } from "./ConfigScreen";

type PropTypes = {
  ctx: RenderItemFormOutletCtx;
};

const AutoSave = ({ ctx }: PropTypes) => {
  const pluginParameters = ctx.plugin.attributes
    .parameters as PluginParametersType;

  useEffect(() => {
    if (ctx.isFormDirty && !ctx.isSubmitting) {
      const debounceTimer = setTimeout(() => {
        ctx.saveCurrentItem(pluginParameters.showNotification);
      }, pluginParameters.autoSaveInterval * 1000);
      return () => {
        clearTimeout(debounceTimer);
      };
    }
  }, [ctx.isFormDirty, ctx.formValues, ctx.isSubmitting]);

  return <></>;
};

export default AutoSave;
