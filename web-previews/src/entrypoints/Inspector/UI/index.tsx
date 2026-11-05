import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui/Canvas';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useEffect, useMemo } from 'react';
import {
  useCompactVisualTabBar,
  useNarrowVisualTabBar,
} from '../../../components/Browser/compactBar';
import { EditModeSwitch } from '../../../components/Browser/EditModeSwitch';
import { PreviewFrame } from '../../../components/Browser/PreviewFrame';
import { ViewportMenu } from '../../../components/Browser/ViewportMenu';
import { useViewport } from '../../../components/Browser/viewport';
import { ReloadIcon } from '../../../icons';
import {
  DEFAULT_SIDEBAR_WIDTH,
  getVisualEditingFrontends,
  normalizeParameters,
  type Parameters,
} from '../../../types';
import { normalizePathForVisualEditing } from '../../../utils/normalizePathForVisualEditing';
import { useContentLink } from '../ContentLinkContext';
import AddressBar from './AddressBar';
import { FrontendSelector } from './AddressBar/FrontendSelector';
import styles from './styles.module.css';

type ContentLink = ReturnType<typeof useContentLink>['contentLink'];

/**
 * Why the address and edit mode cannot change now, while the page is not
 * connected
 */
function disabledReason(contentLink: ContentLink): string | undefined {
  if (contentLink.type === 'connecting') {
    return 'The page is still loading.';
  }

  if (contentLink.type === 'error') {
    // The panel of the inspector says it too, with the next step
    return contentLink.reason === 'failed-connection'
      ? "Visual editing isn't available on this website."
      : 'The page stopped responding. Refresh the preview to try again.';
  }

  return undefined;
}

/**
 * A heartbeat that stops only goes to the console: brief stalls of the
 * website recover on their own, and should not interrupt the editors
 */
function useLogStalledPreview(contentLink: ContentLink) {
  const stalled =
    contentLink.type === 'error' && contentLink.reason === 'no-ping';

  useEffect(() => {
    if (stalled) {
      console.log(
        '[Web Previews] Preview heartbeat stopped. The iframe may have navigated away, stalled, or temporarily stopped responding.',
      );
    }
  }, [stalled]);
}

/**
 * The Visual tab: the toolbar with the address of the page and the controls
 * of the preview, then the website.
 */
const UI = () => {
  const ctx = useCtx<RenderInspectorCtx>();

  const params = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const { iframeAllowAttribute, previewLinksSidebar } = params;
  const visualEditingFrontends = getVisualEditingFrontends(params);

  // The frontend comes from the provider, as the one that the panel sync
  // writes in the URL
  const {
    frontend: selectedFrontend,
    changeFrontend,
    iframeRef,
    iframeState,
    reloadIframe,
    contentLink,
    setPreferredClickToEdit,
  } = useContentLink();

  if (!selectedFrontend.visualEditing) {
    throw new Error(
      `Frontend "${selectedFrontend.name}" is missing visualEditing configuration.`,
    );
  }
  const currentVisualEditing = selectedFrontend.visualEditing;
  const fallbackPath = currentVisualEditing.initialPath || '/';

  const iframeSrc = useMemo(() => {
    const url = new URL(currentVisualEditing.enableDraftModeUrl);
    // Re-validate at the sink so query-parameter tampering cannot reach `redirect`.
    url.searchParams.set(
      'redirect',
      normalizePathForVisualEditing({
        path: iframeState.path,
        draftModeUrl: currentVisualEditing.enableDraftModeUrl,
        fallbackPath,
      }),
    );
    return url.toString();
  }, [currentVisualEditing.enableDraftModeUrl, fallbackPath, iframeState.path]);

  // The size of the preview stays for the session, also when the frontend
  // changes
  const viewport = useViewport();
  // In a narrow frame the viewport trigger shows only its icon (the icon of
  // its choice), and in a very narrow one edit mode drops the hint of the Alt
  // key: the address keeps the width. The frontend trigger keeps its name
  const compactBar = useCompactVisualTabBar();
  const narrowBar = useNarrowVisualTabBar();

  const handleToggleClickToEdit = async () => {
    if (contentLink.type !== 'connected') {
      return;
    }

    setPreferredClickToEdit(!contentLink.state.clickToEditEnabled);
    contentLink.methods.setClickToEditEnabled(
      contentLink.state.clickToEditEnabled
        ? {
            enabled: false,
          }
        : { enabled: true, flash: { scrollToNearestTarget: true } },
    );
  };

  useLogStalledPreview(contentLink);

  return (
    <Pane
      header={
        <Toolbar fields>
          {/* The parts stay in line with the address field, also while it
                shows its error under it */}
          <div className={styles.row}>
            {visualEditingFrontends.length > 1 && (
              <div className={styles.cell}>
                <FrontendSelector
                  frontends={visualEditingFrontends}
                  currentFrontend={selectedFrontend}
                  onChange={changeFrontend}
                />
              </div>
            )}
            {/* A new frontend starts a new address, with no error. While
                  the page connects, the frame and the records panel say that
                  they load: the bar adds no spinner of its own */}
            <AddressBar
              key={selectedFrontend.name}
              frontend={selectedFrontend}
              disabledReason={disabledReason(contentLink)}
            />
            <div className={styles.cell}>
              <Toolbar.Button
                iconOnly
                icon={ReloadIcon}
                label="Refresh the preview"
                onClick={reloadIframe}
              />
            </div>
            {/* The viewport menu hides, and the preview fits the frame,
                  while the frame is narrower than the default width of the
                  Website preview tab */}
            <div className={styles.part}>
              <Toolbar.Divider />
              <div className={styles.cell}>
                <ViewportMenu
                  viewport={viewport}
                  fitLabel="Fit to window"
                  iconOnly={compactBar}
                  minWidth={
                    previewLinksSidebar?.defaultWidth ?? DEFAULT_SIDEBAR_WIDTH
                  }
                />
              </div>
            </div>
            <div className={styles.part}>
              <Toolbar.Divider />
              <div className={styles.cell}>
                <EditModeSwitch
                  showHint={!narrowBar}
                  pressed={
                    contentLink.type === 'connected' &&
                    contentLink.state.clickToEditEnabled
                  }
                  temporary={
                    contentLink.type === 'connected' &&
                    contentLink.clickToEditTemporary
                  }
                  onToggle={handleToggleClickToEdit}
                  disabledReason={disabledReason(contentLink)}
                />
              </div>
            </div>
          </div>
        </Toolbar>
      }
    >
      <PreviewFrame
        src={iframeSrc}
        reloadKey={iframeState.key}
        sizing={viewport.sizing}
        allow={iframeAllowAttribute}
        iframeRef={iframeRef}
      />
    </Pane>
  );
};

export default UI;
