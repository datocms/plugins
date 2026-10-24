import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import { type ReactNode, useEffect, useMemo } from 'react';
import PickerApp from '../components/picker/PickerApp';
import { useDeepStable } from '../components/shared/useDeepStable';
import { PICKER_MODAL_HEIGHT } from '../constants';
import { CircleExclamationIcon } from '../icons';
import {
  getActiveStores,
  isStoreUsable,
  normalizePluginParameters,
} from '../lib/parameters';
import { readPickerParameters } from '../lib/pickerSearch';
import type {
  PickerModalParameters,
  ShopifyKind,
  StoreConnection,
} from '../types';
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
  title,
  message,
}: {
  ctx: RenderModalCtx;
  title: string;
  message: string;
}) {
  return (
    <Canvas ctx={ctx}>
      <BlankSlate
        placement="inline"
        error
        icon={<CircleExclamationIcon />}
        title={title}
        description={message}
      />
    </Canvas>
  );
}

/** The search's placeholder (and name): an example of what it finds. */
const PRODUCT_TEXTS = {
  'fullTextQuery.placeholder': 'T-shirt, SKU or barcode',
};
const COLLECTION_TEXTS = { 'fullTextQuery.placeholder': 'Summer sale' };

/**
 * The plugin's one fixed-height frame: the host sizes the iframe once, and
 * the root fills it inside the Canvas padding, so only the results scroll.
 */
function PickerFrame({
  ctx,
  kind,
  children,
}: {
  ctx: RenderModalCtx;
  kind: ShopifyKind;
  children: ReactNode;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height is set once per frame.
  useEffect(() => {
    void ctx.setHeight(PICKER_MODAL_HEIGHT);
  }, []);
  const [top, , bottom] = ctx.bodyPadding;
  return (
    <Canvas
      ctx={ctx}
      noAutoResizer
      texts={kind === 'collection' ? COLLECTION_TEXTS : PRODUCT_TEXTS}
    >
      <div
        className={styles.root}
        style={{ height: `calc(100vh - ${top + bottom}px)` }}
      >
        {children}
      </div>
    </Canvas>
  );
}

/**
 * `renderModal('shopifyPicker')`: browse the store and resolve with a
 * `PickerModalResult`. The host draws the title, ✕ and Esc (which resolve
 * nothing, meaning cancel).
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
      <ProblemFrame ctx={ctx} title={setup.title} message={setup.message} />
    );
  }

  return (
    <PickerFrame ctx={ctx} kind={setup.params.fieldParameters.kind}>
      <PickerApp ctx={ctx} params={setup.params} store={setup.store} />
    </PickerFrame>
  );
}
