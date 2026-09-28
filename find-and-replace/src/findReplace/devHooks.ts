import type { FindReplaceController } from './contract';

export type DevHooks = {
  /**
   * Called by `FindReplacePage` in dev builds each time a controller is ready.
   * The preview harness uses it to prefill the page (`?q=` and `?r=`).
   */
  onController?: (controller: FindReplaceController) => void;
};

/** Dev-only hooks; nothing sets them in production. */
export const devHooks: DevHooks = {};
