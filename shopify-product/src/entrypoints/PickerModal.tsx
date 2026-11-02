import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import { type ReactNode, useEffect, useMemo } from 'react';
import { SETTINGS_LINK_LABEL } from '../components/field/Notices';
import PickerApp, { settingsOpener } from '../components/picker/PickerApp';
import { useDeepStable } from '../components/shared/useDeepStable';
import { PICKER_MODAL_HEIGHT } from '../constants';
import { CircleExclamationIcon, KindIcon } from '../icons';
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

type Problem = {
  ok: false;
  title: string;
  /** Without one, the title and the way to the settings say it all. */
  message?: string;
  /**
   * Nothing failed: the plugin settings miss this field's store. The frame
   * shows the icon of what the field picks, and the way to the settings (or,
   * for the roles that can't open them, `askAdministrator`).
   */
  notSetUp?: { kind: ShopifyKind; askAdministrator: string };
};

type Setup =
  | { ok: true; params: PickerModalParameters; store: StoreConnection }
  | Problem;

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
  const kind = params.fieldParameters.kind;
  const stores = getActiveStores(normalizePluginParameters(rawPlugin));
  if (!stores.some(isStoreUsable)) {
    return {
      ok: false,
      title: 'No Shopify store connected yet',
      notSetUp: {
        kind,
        askAdministrator:
          'Ask an administrator to connect one in the plugin settings.',
      },
    };
  }
  const store = stores.find(
    (candidate) => candidate.shopDomain === params.shopDomain,
  );
  if (!store || !isStoreUsable(store)) {
    return {
      ok: false,
      title: 'Store not connected',
      message: `This field uses ${params.shopDomain}, which isn't connected to the plugin.`,
      notSetUp: {
        kind,
        askAdministrator: 'Ask an administrator to connect it again.',
      },
    };
  }
  return { ok: true, params, store };
}

/**
 * Problems get a short self-resizing frame instead of the tall picker. A
 * store missing from the plugin settings is not an error: the icon of what
 * the field picks, and the way to the settings for the roles that can open
 * them (the others are sent to an administrator).
 */
function ProblemFrame({
  ctx,
  problem,
}: {
  ctx: RenderModalCtx;
  problem: Problem;
}) {
  if (problem.notSetUp) {
    const openSettings = settingsOpener(ctx);
    return (
      <Canvas ctx={ctx}>
        <BlankSlate
          placement="inline"
          icon={<KindIcon kind={problem.notSetUp.kind} />}
          title={problem.title}
          description={
            openSettings
              ? problem.message
              : [problem.message, problem.notSetUp.askAdministrator]
                  .filter(Boolean)
                  .join(' ')
          }
          actions={
            openSettings ? (
              <Button label={SETTINGS_LINK_LABEL} onClick={openSettings} />
            ) : undefined
          }
        />
      </Canvas>
    );
  }
  return (
    <Canvas ctx={ctx}>
      <BlankSlate
        placement="inline"
        error
        icon={<CircleExclamationIcon />}
        title={problem.title}
        description={problem.message}
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

  if (!setup.ok) return <ProblemFrame ctx={ctx} problem={setup} />;

  return (
    <PickerFrame ctx={ctx} kind={setup.params.fieldParameters.kind}>
      <PickerApp ctx={ctx} params={setup.params} store={setup.store} />
    </PickerFrame>
  );
}
