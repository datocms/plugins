import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import CopyButton from 'datocms-react-ui/CopyButton';
import EntityRow from 'datocms-react-ui/EntityRow';
import Link from 'datocms-react-ui/Link';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Spinner from 'datocms-react-ui/Spinner';
import Tooltip from 'datocms-react-ui/Tooltip';
import type { CSSProperties, ReactNode } from 'react';
import { PreviewSetupGuide } from '../../components/PreviewSetupGuide';
import { ErrorIcon, EyeIcon, OpenInNewTabIcon } from '../../icons';
import type { Frontend, PreviewLink } from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
import {
  errorMessage,
  failedLinksNextStep,
  failedLinksNextStepLead,
  PLUGIN_SETTINGS_WORDS,
  type StatusByFrontend,
  useLogFailures,
} from '../../utils/failures';
import { useFrameSizedToContent } from '../../utils/frame';
import {
  extractRedirectFromDraftModePreviewUrl,
  inspectorUrl,
  pluginSettingsUrl,
} from '../../utils/urls';
import styles from './styles.module.css';

const NO_LINKS = 'No preview links for this record';

// A record that isn't saved yet asks no frontend: the Website preview
// sidebar says the same
const NOT_SAVED = 'Save the record to load its preview links.';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

/**
 * The rows of the panel. The frame already has an inset (its body padding),
 * so the box of the list goes out into it: the text of the rows stays in
 * line with the text of the panel (RowList, “The inset row”).
 */
function InsetRowList({ children }: { children: ReactNode }) {
  const { bodyPadding } = useCtx();
  const [, right = 0, , left = 0] = bodyPadding;
  const frameInsets = {
    '--frame-inset-left': `${left}px`,
    '--frame-inset-right': `${right}px`,
  } as CSSProperties;

  return (
    <div className={styles.rows} style={frameInsets}>
      <RowList>{children}</RowList>
    </div>
  );
}

/**
 * The path of a link, for the details of its row. An endpoint can return a
 * URL that isn't absolute: the row then shows it as it is.
 */
function pathOf(urlString: string): string {
  try {
    const { pathname, search } = new URL(urlString);
    return `${pathname}${search}`;
  } catch {
    return urlString;
  }
}

function PreviewLinkRow({
  previewLink,
  frontend,
  showFrontend,
}: {
  previewLink: PreviewLink;
  frontend: Frontend;
  /** With several frontends, the row names the one that returned it */
  showFrontend: boolean;
}) {
  const ctx = useCtx();
  const { url: urlString, label } = previewLink;
  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl;
  // A link to the draft-mode route of a frontend with visual editing opens
  // its page in the Visual tab too
  const visualEditingPath = draftModeUrl
    ? extractRedirectFromDraftModePreviewUrl(urlString, draftModeUrl)
    : undefined;
  const details = visualEditingPath ?? pathOf(urlString);

  return (
    <RowList.Item>
      <EntityRow
        layout="row"
        kicker={showFrontend ? frontend.name : undefined}
        // The panel is narrow: a long label wraps, so it stays readable
        multilineTitle
        title={label}
        trailing={
          <span className={styles.actions}>
            {visualEditingPath && (
              <Button
                tone="ghost"
                size="micro"
                iconOnly
                icon={EyeIcon}
                label="Open in the Visual tab"
                to={inspectorUrl(ctx, {
                  path: visualEditingPath,
                  frontend: frontend.name,
                })}
              />
            )}
            <CopyButton value={urlString} />
            <Button
              tone="ghost"
              size="micro"
              iconOnly
              icon={OpenInNewTabIcon}
              label="Open in a new tab"
              href={urlString}
              newTab
            />
          </span>
        }
      >
        {/* The details show the path: the full URL is in the tooltip. A URL
            that the details show as it is needs no tooltip */}
        {details === urlString ? (
          <span>{details}</span>
        ) : (
          <Tooltip label={urlString}>
            <span>{details}</span>
          </Tooltip>
        )}
      </EntityRow>
    </RowList.Item>
  );
}

/**
 * The next step in the Callout of a frontend that failed. For the roles
 * that can open the plugin settings, the words that name them are a link
 * there; the other roles get the plain sentence.
 */
function FailedFrontendNextStep() {
  const ctx = useCtx();

  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return <>{failedLinksNextStep(1)}</>;
  }

  return (
    <>
      {failedLinksNextStepLead(1)}{' '}
      <Link to={pluginSettingsUrl(ctx)}>{PLUGIN_SETTINGS_WORDS}</Link>.
    </>
  );
}

function previewLinkKey(frontend: Frontend, previewLink: PreviewLink) {
  return `${frontend.name}\n${previewLink.label}\n${previewLink.url}`;
}

/** The links of the only frontend, or why there are none */
function FrontendResult({
  status,
  frontend,
}: {
  status: FrontendStatus;
  frontend: Frontend;
}) {
  if ('error' in status) {
    return (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<ErrorIcon />}
        title="The preview links didn't load"
        code={errorMessage(status.error)}
        description={failedLinksNextStep(1)}
      />
    );
  }

  if (status.previewLinks.length === 0) {
    return <SidebarPanel.Blank message={NO_LINKS} />;
  }

  return (
    <InsetRowList>
      {status.previewLinks.map((previewLink) => (
        <PreviewLinkRow
          key={previewLinkKey(frontend, previewLink)}
          previewLink={previewLink}
          frontend={frontend}
          showFrontend={false}
        />
      ))}
    </InsetRowList>
  );
}

/**
 * The links of several frontends in one list, each row naming its frontend.
 * A frontend that failed gets a message above the list; a frontend with no
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
  const failures = frontends.flatMap((frontend) => {
    const status = statusByFrontend[frontend.name];
    return status && 'error' in status
      ? [{ frontend, error: status.error }]
      : [];
  });

  const linksByFrontend = frontends.flatMap((frontend) => {
    const status = statusByFrontend[frontend.name];
    return status && 'previewLinks' in status && status.previewLinks.length > 0
      ? [{ frontend, previewLinks: status.previewLinks }]
      : [];
  });

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
                {`${frontend.name}: ${errorMessage(error)}`}
              </div>
            ))}
          </div>
        }
        description={failedLinksNextStep(failures.length)}
      />
    );
  }

  return (
    <>
      {failures.map(({ frontend }) => (
        <Callout
          key={frontend.name}
          tone="danger"
          title={`“${frontend.name}” didn't return its preview links`}
        >
          <FailedFrontendNextStep />
        </Callout>
      ))}
      <InsetRowList>
        {linksByFrontend.flatMap(({ frontend, previewLinks }) =>
          previewLinks.map((previewLink) => (
            <PreviewLinkRow
              key={previewLinkKey(frontend, previewLink)}
              previewLink={previewLink}
              frontend={frontend}
              showFrontend
            />
          )),
        )}
      </InsetRowList>
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
 * The “Related website pages” panel of the record sidebar: the pages that
 * each frontend returns for the record.
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
    return <Spinner.Area size="small" label="Loading the preview links" />;
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
