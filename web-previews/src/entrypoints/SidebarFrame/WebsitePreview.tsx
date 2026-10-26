import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useCallback, useEffect, useState } from 'react';
import { CustomSizeBar } from '../../components/Browser/CustomSizeBar';
import { PreviewFrame } from '../../components/Browser/PreviewFrame';
import { ViewportMenu } from '../../components/Browser/ViewportMenu';
import type { ViewportState } from '../../components/Browser/viewport';
import { EyeIcon, OpenInNewTabIcon, ReloadIcon } from '../../icons';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLinkWithFrontend,
} from '../../types';
import type { FrontendStatus } from '../../utils/common';
import { inspectorUrl } from '../../utils/urls';
import { PreviewLinkMenu } from './PreviewLinkMenu';
import { sidebarVisualEditingInfo } from './previewLinkSelection';
import styles from './styles.module.css';
import { useSidebarContentLink } from './useSidebarContentLink';

/** Below this sidebar width the toolbar has no room for the viewport selector */
const VIEWPORT_SELECTOR_MIN_WIDTH = 600;

type Props = {
  ctx: RenderItemFormSidebarCtx;
  frontends: Frontend[];
  statusByFrontend: Record<string, FrontendStatus | undefined>;
  selectedPreviewLink: PreviewLinkWithFrontend;
  onSelectPreviewLink: (previewLink: PreviewLinkWithFrontend) => void;
  viewport: ViewportState;
};

/**
 * A link that reloads its page when the record changes reloads the preview
 * each time the response gives the link again
 */
function useReloadOnRecordUpdate(
  previewLink: PreviewLinkWithFrontend,
  reload: () => void,
) {
  useEffect(() => {
    const reloadSettings = previewLink.reloadPreviewOnRecordUpdate;

    if (!reloadSettings) {
      return;
    }

    const delayInMs = reloadSettings === true ? 100 : reloadSettings.delayInMs;
    const timeout = setTimeout(reload, delayInMs);

    return () => clearTimeout(timeout);
  }, [reload, previewLink]);
}

/**
 * The preview of the record in the sidebar: the toolbar with the menu of
 * the links and the actions on the page, then the website.
 */
export function WebsitePreview({
  ctx,
  frontends,
  statusByFrontend,
  selectedPreviewLink,
  onSelectPreviewLink,
  viewport,
}: Props) {
  const { iframeAllowAttribute, showVisualTab } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const frontend = frontends.find(
    (f) => f.name === selectedPreviewLink.frontendName,
  );
  const visualEditing = sidebarVisualEditingInfo(selectedPreviewLink, frontend);

  // Draft previews may load the Content Link script; connect only to keep its
  // click-to-edit overlay disabled inside the sidebar.
  const connectContentLink = Boolean(visualEditing?.alreadyInDraftMode);
  const { iframeRef } = useSidebarContentLink(
    ctx,
    connectContentLink ? false : undefined,
  );

  const [reloadCounter, setReloadCounter] = useState(0);
  const reload = useCallback(() => setReloadCounter((old) => old + 1), []);
  useReloadOnRecordUpdate(selectedPreviewLink, reload);

  // A new URL or a reload is a new iframe: it loads until its load event
  const reloadKey = `${selectedPreviewLink.url}-${reloadCounter}`;
  const [loadedKey, setLoadedKey] = useState<string>();
  const iframeLoading = loadedKey !== reloadKey;

  const visualTabUrl =
    showVisualTab && visualEditing
      ? inspectorUrl(ctx, {
          path: visualEditing.path,
          frontend: selectedPreviewLink.frontendName,
        })
      : undefined;

  return (
    <Pane
      header={
        <>
          <Toolbar>
            <Toolbar.Fill className={styles.fill}>
              <PreviewLinkMenu
                frontends={frontends}
                statusByFrontend={statusByFrontend}
                selectedPreviewLink={selectedPreviewLink}
                onChange={onSelectPreviewLink}
              />
            </Toolbar.Fill>
            <Toolbar.Spinner show={iframeLoading} />
            {/* Pages with real-time updates refresh themselves, so they need
                no button */}
            {selectedPreviewLink.realtimeUpdates !== true && (
              <Toolbar.Button
                iconOnly
                icon={ReloadIcon}
                label="Refresh the preview"
                onClick={reload}
              />
            )}
            <ViewportMenu
              value={viewport.choice}
              onChange={viewport.setChoice}
              fitLabel="Fit to sidebar"
              iconOnly={false}
              minWidth={VIEWPORT_SELECTOR_MIN_WIDTH}
            />
            <div className={styles.actions}>
              <Toolbar.Group>
                {visualTabUrl && (
                  <Toolbar.Button
                    iconOnly
                    icon={EyeIcon}
                    label="Edit in Visual Editing"
                    to={visualTabUrl}
                  />
                )}
                <Toolbar.Button
                  iconOnly
                  icon={OpenInNewTabIcon}
                  label="Open in a new tab"
                  href={selectedPreviewLink.url}
                  newTab
                />
              </Toolbar.Group>
            </div>
          </Toolbar>
          {viewport.choice === 'custom' && (
            <CustomSizeBar
              size={viewport.customSize}
              onChange={viewport.setCustomSize}
            />
          )}
        </>
      }
    >
      <PreviewFrame
        src={selectedPreviewLink.url}
        reloadKey={reloadKey}
        sizing={viewport.sizing}
        allow={iframeAllowAttribute}
        iframeRef={connectContentLink ? iframeRef : undefined}
        onLoad={() => setLoadedKey(reloadKey)}
      />
    </Pane>
  );
}
