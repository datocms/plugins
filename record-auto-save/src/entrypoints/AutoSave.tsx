import type { RenderItemFormOutletCtx } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import type { PluginParametersType } from './ConfigScreen';

type PropTypes = {
  ctx: RenderItemFormOutletCtx;
};

type AutoSaveTimerProps = {
  autoSaveInterval: number;
  ctx: RenderItemFormOutletCtx;
  showNotification: boolean;
};

const AutoSave = ({ ctx }: PropTypes) => {
  const pluginParameters = ctx.plugin.attributes
    .parameters as PluginParametersType;
  const autoSaveInterval = pluginParameters.autoSaveInterval || 5;
  const showNotification = pluginParameters.showNotification || false;

  if (pluginParameters.startTimerAfterEditingStops) {
    return (
      <AutoSaveAfterEditingStops
        autoSaveInterval={autoSaveInterval}
        ctx={ctx}
        showNotification={showNotification}
      />
    );
  }

  return (
    <AutoSaveAfterFirstChange
      autoSaveInterval={autoSaveInterval}
      ctx={ctx}
      showNotification={showNotification}
    />
  );
};

const AutoSaveAfterFirstChange = ({
  autoSaveInterval,
  ctx,
  showNotification,
}: AutoSaveTimerProps) => {
  useEffect(() => {
    if (ctx.isFormDirty && !ctx.isSubmitting) {
      const timer = setTimeout(() => {
        ctx.saveCurrentItem(showNotification);
      }, autoSaveInterval * 1000);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [
    autoSaveInterval,
    ctx.isFormDirty,
    ctx.isSubmitting,
    ctx.saveCurrentItem,
    showNotification,
  ]);

  return null;
};

const AutoSaveAfterEditingStops = ({
  autoSaveInterval,
  ctx,
  showNotification,
}: AutoSaveTimerProps) => {
  const formValuesSnapshot = JSON.stringify(ctx.formValues);

  useEffect(() => {
    if (ctx.isFormDirty && !ctx.isSubmitting) {
      const timer = setTimeout(() => {
        ctx.saveCurrentItem(showNotification);
      }, autoSaveInterval * 1000);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [
    autoSaveInterval,
    ctx.isFormDirty,
    ctx.isSubmitting,
    ctx.saveCurrentItem,
    formValuesSnapshot,
    showNotification,
  ]);

  return null;
};

export default AutoSave;
