import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui/Canvas';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useEffect, useMemo, useRef } from 'react';
import { CustomSizeBar } from '../../../components/Browser/CustomSizeBar';
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

// The Alt gesture belongs to the Content Link script of the website, not to
// an action of the plugin, thus the hint names the key in words
const EDIT_MODE_TOOLTIP =
  'Click an element of the page to edit its record. Holding Alt (Option on a Mac) flips edit mode while the key is down.';

/** Why edit mode cannot change now, while the page is not connected */
function editModeDisabledReason(contentLink: ContentLink): string | undefined {
  switch (contentLink.type) {
    case 'connecting':
      return 'Wait for the page to connect.';
    case 'error':
      return "The website doesn't respond. Check that DatoCMS Content Link is installed on it.";
    default:
      return undefined;
  }
}

/**
 * A connection that fails gets one alert for each reason. A heartbeat that
 * stops only goes to the console.
 */
function useReportContentLinkErrors(
  contentLink: ContentLink,
  alert: (message: string) => Promise<void>,
) {
  const reportedErrorReasonRef = useRef<string | null>(null);

  const contentLinkErrorReason =
    contentLink.type === 'error' ? contentLink.reason : undefined;

  useEffect(() => {
    if (!contentLinkErrorReason) {
      reportedErrorReasonRef.current = null;
      return;
    }

    if (reportedErrorReasonRef.current === contentLinkErrorReason) {
      return;
    }

    reportedErrorReasonRef.current = contentLinkErrorReason;

    if (contentLinkErrorReason === 'failed-connection') {
      alert(
        "The website doesn't respond to the Visual tab. Check that DatoCMS Content Link is installed on the website.",
      );
    }

    if (contentLinkErrorReason === 'no-ping') {
      // Based on editor feedback, transient preview stalls should not interrupt
      // normal users. Keep the heartbeat as a developer diagnostic, but avoid a
      // visible alert because brief script hangs can recover on their own.
      console.log(
        '[Web Previews] Preview heartbeat stopped. The iframe may have navigated away, stalled, or temporarily stopped responding.',
      );
    }
  }, [contentLinkErrorReason, alert]);
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
  const { iframeAllowAttribute } = params;
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
  // its choice), and in a very narrow one the frontend trigger and edit mode
  // too: the address keeps the width. The icon of the frontend trigger is the
  // same for every frontend, so it keeps its name as long as it can
  const compactBar = useCompactVisualTabBar();
  const narrowBar = useNarrowVisualTabBar();

  const handleToggleClickToEdit = async () => {
    if (contentLink.type !== 'connected') {
      return;
    }

    contentLink.methods.setClickToEditEnabled(
      contentLink.state.clickToEditEnabled
        ? {
            enabled: false,
          }
        : { enabled: true, flash: { scrollToNearestTarget: true } },
    );
  };

  useReportContentLinkErrors(contentLink, ctx.alert);

  return (
    <Pane
      header={
        <>
          <Toolbar fields>
            {/* The parts stay in line with the address field, also while it
                shows its error under it */}
            <div className={styles.row}>
              {/* A new frontend starts a new address, with no error */}
              <AddressBar
                key={selectedFrontend.name}
                frontend={selectedFrontend}
              />
              {contentLink.type === 'connecting' && (
                <div className={styles.cell}>
                  <Toolbar.Spinner show />
                </div>
              )}
              <div className={styles.cell}>
                <Toolbar.Button
                  iconOnly
                  icon={ReloadIcon}
                  label="Reload the page"
                  onClick={reloadIframe}
                />
              </div>
              {visualEditingFrontends.length > 1 && (
                <div className={styles.cell}>
                  <FrontendSelector
                    frontends={visualEditingFrontends}
                    currentFrontend={selectedFrontend}
                    onChange={changeFrontend}
                    iconOnly={narrowBar}
                  />
                </div>
              )}
              <div className={styles.cell}>
                <ViewportMenu
                  value={viewport.choice}
                  onChange={viewport.setChoice}
                  fitLabel="Fit to window"
                  iconOnly={compactBar}
                />
              </div>
              <div className={styles.cell}>
                <EditModeSwitch
                  iconOnly={narrowBar}
                  pressed={
                    contentLink.type === 'connected' &&
                    contentLink.state.clickToEditEnabled
                  }
                  onToggle={handleToggleClickToEdit}
                  // Two sentences: a paragraph, in the wide tooltip
                  tooltip={EDIT_MODE_TOOLTIP}
                  long
                  disabledReason={editModeDisabledReason(contentLink)}
                />
              </div>
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
