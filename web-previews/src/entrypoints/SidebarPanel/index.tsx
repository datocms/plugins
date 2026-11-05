import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { type BaseCtx, useCtx } from 'datocms-react-ui/Canvas';
import EntityRow from 'datocms-react-ui/EntityRow';
import Heading from 'datocms-react-ui/Heading';
import IconAvatar from 'datocms-react-ui/IconAvatar';
import Link from 'datocms-react-ui/Link';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import { PreviewSetupGuide } from '../../components/PreviewSetupGuide';
import {
  ErrorIcon,
  EyeIcon,
  GlobeIcon,
  OpenInNewTabIcon,
  SidebarIcon,
} from '../../icons';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLink,
} from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
import {
  FAILED_LINKS_NEXT_STEP,
  FAILED_LINKS_NEXT_STEP_LEAD,
  failureLine,
  PLUGIN_SETTINGS_WORDS,
  type StatusByFrontend,
  useLogFailures,
} from '../../utils/failures';
import { useFrameSizedToContent } from '../../utils/frame';
import {
  displayPath,
  extractRedirectFromDraftModePreviewUrl,
  inspectorUrl,
  pluginSettingsUrl,
} from '../../utils/urls';
import styles from './styles.module.css';

const NO_LINKS = 'No preview links for this record';

// A record that isn't saved yet asks no frontend: the Website preview
// sidebar says the same
const NOT_SAVED = 'Save the record to preview it';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

/** Shows a link of a frontend in the Website preview sidebar */
export type PreviewInSidebar = (link: PreviewLink, frontend: Frontend) => void;

/**
 * The host puts the panel and the group of the outlet under a level 2
 * title, thus the name of a frontend is a level 3 heading
 */
const FRONTEND_HEADING_LEVEL = 3;

/**
 * One row per link: its label, then the host and the path of its page. The
 * actions show on hover: the sidebar, Visual Editing for a draft-mode link
 * of a frontend that has it, and a new tab.
 */
function PreviewLinkRow({
  frontend,
  link,
  onPreviewInSidebar,
}: {
  frontend: Frontend;
  link: PreviewLink;
  /** With it, the row has the action that shows the page in the sidebar */
  onPreviewInSidebar: PreviewInSidebar | undefined;
}) {
  const ctx = useCtx();
  const { showVisualTab } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl;
  // A link to the draft-mode route of a frontend with visual editing opens
  // its page in the Visual Editing tab too
  const visualEditingPath =
    showVisualTab && draftModeUrl
      ? extractRedirectFromDraftModePreviewUrl(link.url, draftModeUrl)
      : undefined;

  return (
    <RowList.Item>
      <EntityRow
        layout="row"
        image={<IconAvatar icon={GlobeIcon} size={32} surface="muted" />}
        title={link.label}
        trailing={
          <RowList.Actions>
            {onPreviewInSidebar && (
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={SidebarIcon}
                label="Preview in the sidebar"
                onClick={() => onPreviewInSidebar(link, frontend)}
              />
            )}
            {visualEditingPath && (
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={EyeIcon}
                label="Edit in Visual Editing"
                to={inspectorUrl(ctx, {
                  path: visualEditingPath,
                  frontend: frontend.name,
                })}
              />
            )}
            <Button
              tone="ghost"
              size="micro"
              iconOnly
              icon={OpenInNewTabIcon}
              label="Open in a new tab"
              href={link.url}
              newTab
            />
          </RowList.Actions>
        }
      >
        {displayPath(link.url)}
      </EntityRow>
    </RowList.Item>
  );
}

/**
 * The rows of the links of each frontend. With several frontends, the name
 * of each one is the heading of its rows. The panel frame and the group of
 * the form already have an inset: the compact list keeps the text of the
 * rows on its edge.
 */
export function PreviewLinkRows({
  linksByFrontend,
  showFrontend,
  onPreviewInSidebar,
}: {
  linksByFrontend: { frontend: Frontend; previewLinks: PreviewLink[] }[];
  /** Each frontend names its rows (with several frontends) */
  showFrontend: boolean;
  /** With it, each row has the action that shows the page in the sidebar */
  onPreviewInSidebar?: PreviewInSidebar;
}) {
  return (
    <>
      {linksByFrontend.map(({ frontend, previewLinks }) => (
        <div key={frontend.name} className={styles.frontend}>
          {showFrontend && (
            <Heading
              level={FRONTEND_HEADING_LEVEL}
              className={styles.frontendName}
            >
              {frontend.name}
            </Heading>
          )}
          <RowList density="compact">
            {previewLinks.map((link) => (
              <PreviewLinkRow
                key={`${link.label}\n${link.url}`}
                frontend={frontend}
                link={link}
                onPreviewInSidebar={onPreviewInSidebar}
              />
            ))}
          </RowList>
        </div>
      ))}
    </>
  );
}

/** The frontends that returned at least one link, with their links */
export function linksByFrontendOf(
  frontends: Frontend[],
  statusByFrontend: StatusByFrontend,
) {
  return frontends.flatMap((frontend) => {
    const status = statusByFrontend[frontend.name];
    return status && 'previewLinks' in status && status.previewLinks.length > 0
      ? [{ frontend, previewLinks: status.previewLinks }]
      : [];
  });
}

/**
 * The next step in the Callout of a frontend that failed. For the roles
 * that can open the plugin settings, the words that name them are a link
 * there; the other roles get the plain sentence.
 */
function FailedFrontendNextStep() {
  const ctx = useCtx();

  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return <>{FAILED_LINKS_NEXT_STEP}</>;
  }

  return (
    <>
      {FAILED_LINKS_NEXT_STEP_LEAD}{' '}
      <Link to={pluginSettingsUrl(ctx)}>{PLUGIN_SETTINGS_WORDS}</Link>.
    </>
  );
}

/**
 * The action of an error state: the roles that can change the settings get
 * the way to them, the others none
 */
function settingsAction(ctx: BaseCtx) {
  return ctx.currentRole.meta.final_permissions.can_edit_schema ? (
    <Button label="Open plugin settings" to={pluginSettingsUrl(ctx)} />
  ) : undefined;
}

/** The links of the only frontend, or why there are none */
function FrontendResult({
  status,
  frontend,
}: {
  status: FrontendStatus;
  frontend: Frontend;
}) {
  const ctx = useCtx();

  if ('error' in status) {
    return (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<ErrorIcon />}
        title="The preview links didn't load"
        code={failureLine({
          frontend: frontend.name,
          error: status.error,
          named: false,
        })}
        description={FAILED_LINKS_NEXT_STEP}
        actions={settingsAction(ctx)}
      />
    );
  }

  if (status.previewLinks.length === 0) {
    return <SidebarPanel.Blank message={NO_LINKS} />;
  }

  return (
    <PreviewLinkRows
      linksByFrontend={[{ frontend, previewLinks: status.previewLinks }]}
      showFrontend={false}
    />
  );
}

/**
 * The links of several frontends in one list, each row naming its frontend.
 * A frontend that failed gets a message under the list; a frontend with no
 * links (or no result yet) is left out. With no link at all, the failures are
 * the whole content.
 */
function SeveralFrontendsResult({
  frontends,
  statusByFrontend,
}: {
  frontends: Frontend[];
  statusByFrontend: StatusByFrontend;
}) {
  const ctx = useCtx();
  const failures = frontends.flatMap((frontend) => {
    const status = statusByFrontend[frontend.name];
    return status && 'error' in status
      ? [{ frontend, error: status.error }]
      : [];
  });

  const linksByFrontend = linksByFrontendOf(frontends, statusByFrontend);

  if (linksByFrontend.length === 0 && failures.length === 0) {
    return <SidebarPanel.Blank message={NO_LINKS} />;
  }

  if (linksByFrontend.length === 0) {
    return (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<ErrorIcon />}
        title="The preview links didn't load"
        // One line for each frontend that failed
        code={
          <div>
            {failures.map(({ frontend, error }) => (
              <div key={frontend.name}>
                {failureLine({ frontend: frontend.name, error, named: true })}
              </div>
            ))}
          </div>
        }
        description={FAILED_LINKS_NEXT_STEP}
        actions={settingsAction(ctx)}
      />
    );
  }

  // The links that work come first, where the editor expects them
  return (
    <>
      <PreviewLinkRows linksByFrontend={linksByFrontend} showFrontend />
      {failures.map(({ frontend }, index) => (
        <Callout
          key={frontend.name}
          // The compact list has no margin: the first callout keeps its
          // distance from the rows
          className={index === 0 ? styles.afterRows : undefined}
          tone="danger"
          title={`“${frontend.name}” didn't return its preview links`}
        >
          <FailedFrontendNextStep />
        </Callout>
      ))}
    </>
  );
}

/** No result yet, or a result with no links */
function hasNoLinks(status: FrontendStatus | undefined) {
  return (
    !status || ('previewLinks' in status && status.previewLinks.length === 0)
  );
}

/**
 * The “Preview links” panel of the record sidebar: the pages that each
 * frontend returns for the record.
 */
export default function PreviewLinksPanel({ ctx }: PropTypes) {
  useFrameSizedToContent();
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  useLogFailures(statusByFrontend);

  // No request runs without a frontend: the guide shows at once
  if (frontends.length === 0) {
    return <PreviewSetupGuide placement="inline" small />;
  }

  // Nor for a record that isn't saved yet: the frontends get the saved
  // record, so the panel says why it has no links
  if (!ctx.item) {
    return <SidebarPanel.Blank message={NOT_SAVED} />;
  }

  // The spinner shows only before the first response: a refresh keeps the
  // last links on screen
  if (!statusByFrontend) {
    return (
      <BlankSlate
        placement="inline"
        small
        loading
        title="Loading the preview links"
      />
    );
  }

  const firstStatus = Object.values(statusByFrontend)[0];

  if (frontends.length === 1 && firstStatus) {
    return <FrontendResult status={firstStatus} frontend={frontends[0]} />;
  }

  if (Object.values(statusByFrontend).every(hasNoLinks)) {
    return <SidebarPanel.Blank message={NO_LINKS} />;
  }

  return (
    <SeveralFrontendsResult
      frontends={frontends}
      statusByFrontend={statusByFrontend}
    />
  );
}
