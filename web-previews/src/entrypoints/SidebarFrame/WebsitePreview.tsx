import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCopyToClipboard } from 'datocms-react-ui/hooks/useCopyToClipboard';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useCallback, useEffect, useState } from 'react';
import { CustomSizeBar } from '../../components/Browser/CustomSizeBar';
import { useCompactSidebarBar } from '../../components/Browser/compactBar';
import { EditModeSwitch } from '../../components/Browser/EditModeSwitch';
import { PreviewFrame } from '../../components/Browser/PreviewFrame';
import { ViewportMenu } from '../../components/Browser/ViewportMenu';
import type { ViewportState } from '../../components/Browser/viewport';
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  OpenInNewTabIcon,
  ReloadIcon,
} from '../../icons';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLinkWithFrontend,
} from '../../types';
import type { FrontendStatus } from '../../utils/common';
import { inspectorUrl } from '../../utils/urls';
import { PreviewLinkMenu } from './PreviewLinkMenu';
import {
  editModeApplies,
  editModeDisabledReason,
  previewModeOf,
} from './previewMode';
import styles from './styles.module.css';
import { useSidebarContentLink } from './useSidebarContentLink';

type Props = {
  ctx: RenderItemFormSidebarCtx;
  frontends: Frontend[];
  statusByFrontend: Record<string, FrontendStatus | undefined>;
  previewLinks: PreviewLinkWithFrontend[];
  selectedPreviewLink: PreviewLinkWithFrontend;
  onSelectPreviewLink: (previewLink: PreviewLinkWithFrontend) => void;
  viewport: ViewportState;
  editModeEnabled: boolean;
  onEditModeChange: (enabled: boolean) => void;
};

/** Copies the URL of the preview; the button tells it for a moment */
function CopyUrlButton({ url }: { url: string }) {
  const { copied, copy } = useCopyToClipboard(url);

  return (
    <Toolbar.Button
      iconOnly
      icon={copied ? CheckIcon : CopyIcon}
      label={copied ? { id: 'clipboard.copied' } : { id: 'clipboard.copy' }}
      onClick={copy}
    />
  );
}

type PreviewActionsProps = {
  /** The URL that the iframe loads */
  url: string;
  /** The page of the Visual tab that shows the link, when it has one */
  visualTabUrl: string | undefined;
  onReload: () => void;
};

/**
 * The actions on the preview, as the buttons of the bar. The group keeps the
 * width of its buttons: the menu of the links gets narrower instead, and
 * the buttons never go over the controls after them.
 */
function PreviewActionButtons({
  url,
  visualTabUrl,
  onReload,
}: PreviewActionsProps) {
  return (
    <div className={styles.actions}>
      <Toolbar.Group>
        <Toolbar.Button
          iconOnly
          icon={ReloadIcon}
          label="Reload the preview"
          onClick={onReload}
        />
        {visualTabUrl && (
          <Toolbar.Button
            iconOnly
            icon={EyeIcon}
            label="Open in the Visual tab"
            to={visualTabUrl}
          />
        )}
        <CopyUrlButton url={url} />
        <Toolbar.Button
          iconOnly
          icon={OpenInNewTabIcon}
          label="Open in a new tab"
          href={url}
          newTab
        />
      </Toolbar.Group>
    </div>
  );
}

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
 * the links and the actions on the page (two bars in a narrow sidebar), then
 * the website.
 */
export function WebsitePreview({
  ctx,
  frontends,
  statusByFrontend,
  previewLinks,
  selectedPreviewLink,
  onSelectPreviewLink,
  viewport,
  editModeEnabled,
  onEditModeChange,
}: Props) {
  const { iframeAllowAttribute } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const mode = previewModeOf({
    previewLink: selectedPreviewLink,
    previewLinks,
    frontends,
    editModeEnabled,
  });
  const { visualEditing, editModeActive, shownPreviewLink } = mode;

  const { iframeRef } = useSidebarContentLink(
    ctx,
    mode.connectContentLink ? editModeActive : undefined,
  );

  // A narrow sidebar has two bars: the menu of the links gets the whole width
  // of the first one, and the controls go in the second one
  const compactBar = useCompactSidebarBar();

  const [reloadCounter, setReloadCounter] = useState(0);
  const reload = useCallback(() => setReloadCounter((old) => old + 1), []);
  useReloadOnRecordUpdate(selectedPreviewLink, reload);

  // A new URL or a reload is a new iframe: it loads until its load event
  const reloadKey = `${shownPreviewLink.url}-${reloadCounter}`;
  const [loadedKey, setLoadedKey] = useState<string>();
  const iframeLoading = loadedKey !== reloadKey;

  const previewActions: PreviewActionsProps = {
    url: shownPreviewLink.url,
    visualTabUrl: visualEditing
      ? inspectorUrl(ctx, {
          path: visualEditing.path,
          frontend: selectedPreviewLink.frontendName,
        })
      : undefined,
    onReload: reload,
  };

  const linkMenu = (
    <Toolbar.Fill className={styles.fill}>
      <PreviewLinkMenu
        frontends={frontends}
        statusByFrontend={statusByFrontend}
        selectedPreviewLink={selectedPreviewLink}
        shownPreviewLink={shownPreviewLink}
        onChange={onSelectPreviewLink}
      />
    </Toolbar.Fill>
  );

  // Edit mode needs a frontend with visual editing. With one, the button
  // stays for every link, disabled with the reason when the link can't use
  // it, so the toolbar doesn't move. Without one, edit mode doesn't apply to
  // the project, and a button that no editor can ever turn on is hidden
  const showsEditMode = editModeApplies(frontends);

  const controls = (
    <>
      <ViewportMenu
        value={viewport.choice}
        onChange={viewport.setChoice}
        fitLabel="Fit to sidebar"
        iconOnly={compactBar}
      />
      {showsEditMode && (
        <EditModeSwitch
          // In the second bar of a narrow sidebar, the switch shows without its
          // label, as the other controls of that bar show only icons: with it, the bar
          // doesn't fit in a 300px sidebar
          iconOnly={compactBar}
          pressed={editModeActive}
          onToggle={() => onEditModeChange(!editModeActive)}
          tooltip="Click an element of the page to open its record"
          disabledReason={editModeDisabledReason(mode)}
        />
      )}
    </>
  );

  return (
    <Pane
      header={
        <>
          {compactBar ? (
            <>
              <Toolbar>
                {linkMenu}
                <Toolbar.Spinner show={iframeLoading} />
              </Toolbar>
              {/* The second bar under the main one is a short one */}
              <Toolbar style="short">
                <PreviewActionButtons {...previewActions} />
                <Toolbar.Space />
                {controls}
              </Toolbar>
            </>
          ) : (
            <Toolbar>
              {linkMenu}
              <Toolbar.Spinner show={iframeLoading} />
              <PreviewActionButtons {...previewActions} />
              {controls}
            </Toolbar>
          )}
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
        src={shownPreviewLink.url}
        reloadKey={reloadKey}
        sizing={viewport.sizing}
        allow={iframeAllowAttribute}
        iframeRef={mode.connectContentLink ? iframeRef : undefined}
        onLoad={() => setLoadedKey(reloadKey)}
      />
    </Pane>
  );
}
