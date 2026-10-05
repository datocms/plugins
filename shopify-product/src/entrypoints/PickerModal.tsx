import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { type ReactNode, useEffect, useMemo } from 'react';
import PickerApp from '../components/picker/PickerApp';
import Callout from '../components/shared/Callout';
import { useDeepStable } from '../components/shared/useDeepStable';
import { PICKER_MODAL_HEIGHT } from '../constants';
import {
  getActiveStores,
  isStoreUsable,
  normalizePluginParameters,
} from '../lib/parameters';
import { readPickerParameters } from '../lib/pickerSearch';
import type { PickerModalParameters, StoreConnection } from '../types';
import styles from './PickerModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type Setup =
  | { ok: true; params: PickerModalParameters; store: StoreConnection }
  | { ok: false; title: string; message: string };

function resolveSetup(rawParameters: unknown, rawPlugin: unknown): Setup {
  const params = readPickerParameters(rawParameters);
  if (!params) {
    return {
      ok: false,
      title: "Couldn't open the picker",
      message:
        "The field sent settings the picker doesn't understand. Close this window and open it again from the field.",
    };
  }
  const stores = getActiveStores(normalizePluginParameters(rawPlugin));
  if (!stores.some(isStoreUsable)) {
    return {
      ok: false,
      title: "The plugin isn't set up yet",
      message:
        'Add a Shopify shop domain and a Storefront access token in the plugin settings to browse products.',
    };
  }
  const store = stores.find(
    (candidate) => candidate.shopDomain === params.shopDomain,
  );
  if (!store || !isStoreUsable(store)) {
    return {
      ok: false,
      title: 'Store not connected',
      message: `This field browses ${params.shopDomain}, which isn't connected in the plugin settings anymore. Add it back there, or choose another store in the field settings.`,
    };
  }
  return { ok: true, params, store };
}

/** Problems get a short self-resizing frame instead of the tall picker. */
function ProblemFrame({
  ctx,
  children,
}: {
  ctx: RenderModalCtx;
  children: ReactNode;
}) {
  return (
    <Canvas ctx={ctx}>
      <div className="dl-kit-form-parity">{children}</div>
    </Canvas>
  );
}

function PickerFrame({
  ctx,
  children,
}: {
  ctx: RenderModalCtx;
  children: ReactNode;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height is set once per frame.
  useEffect(() => {
    void ctx.setHeight(PICKER_MODAL_HEIGHT);
  }, []);
  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={`dl-kit-form-parity ${styles.root}`}>{children}</div>
    </Canvas>
  );
}

/**
 * `renderModal('shopifyPicker')`: browse the store and resolve with a
 * `PickerModalResult`. The host draws the title, ✕ and Esc (which resolve
 * nothing, meaning cancel). The modal is the one fixed-height frame: the
 * results scroll inside it.
 */
export default function PickerModal({ ctx }: Props) {
  const rawParameters = useDeepStable<unknown>(ctx.parameters);
  const rawPlugin = useDeepStable<unknown>(ctx.plugin.attributes.parameters);
  const setup = useMemo(
    () => resolveSetup(rawParameters, rawPlugin),
    [rawParameters, rawPlugin],
  );

  if (!setup.ok) {
    return (
      <ProblemFrame ctx={ctx}>
        <Callout tone="danger" role="alert" title={setup.title}>
          <p>{setup.message}</p>
        </Callout>
      </ProblemFrame>
    );
  }

  return (
    <PickerFrame ctx={ctx}>
      <PickerApp ctx={ctx} params={setup.params} store={setup.store} />
    </PickerFrame>
  );
}
