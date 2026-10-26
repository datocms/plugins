import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import IconTrigger from 'datocms-react-ui/Dropdown/triggers/IconTrigger';
import EntityRow from 'datocms-react-ui/EntityRow';
import Link from 'datocms-react-ui/Link';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useRef,
} from 'react';
import { PreviewSetupGuide } from '../../components/PreviewSetupGuide';
import {
  ActionToggleIcon,
  ErrorIcon,
  EyeIcon,
  OpenInNewTabIcon,
} from '../../icons';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLink,
} from '../../types';
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
  displayPath,
  displayUrl,
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
 * line with the text of the panel (RowList, “The inset row”). In a
 * Page.Group, the inset is the padding of the group instead.
 */
function InsetRowList({
  children,
  inGroup,
}: {
  children: ReactNode;
  inGroup?: boolean;
}) {
  const { bodyPadding } = useCtx();
  const [, right = 0, , left = 0] = bodyPadding;
  const frameInsets = {
    '--frame-inset-left': `${left}px`,
    '--frame-inset-right': `${right}px`,
  } as CSSProperties;

  return (
    <div className={styles.rows} style={inGroup ? undefined : frameInsets}>
      <RowList>{children}</RowList>
    </div>
  );
}

/**
 * The link the path opens: the draft-mode one when we can tell (by the
 * frontend's draft mode URL, then by label), otherwise the first.
 */
function primaryLinkOf(links: PreviewLink[], draftModeUrl: string | undefined) {
  return (
    links.find(
      ({ url }) =>
        draftModeUrl &&
        extractRedirectFromDraftModePreviewUrl(url, draftModeUrl) !== undefined,
    ) ??
    links.find(({ label }) => /draft/i.test(label)) ??
    links[0]
  );
}

/** The links of each page (host and clean path), in the order they came */
function linksByPage(previewLinks: PreviewLink[]): [string, PreviewLink[]][] {
  const pages = new Map<string, PreviewLink[]>();
  for (const previewLink of previewLinks) {
    const page = displayUrl(previewLink.url);
    pages.set(page, [...(pages.get(page) ?? []), previewLink]);
  }
  return [...pages];
}

/** The open row menu that the frame keeps room for (one is open at a time) */
let roomHolder: HTMLElement | null = null;

/**
 * The frames of the panel and of the form outlet are only as tall as their
 * rows, and the kit fits an open menu inside the frame, so a row's menu
 * would scroll in a sliver. While a menu is open, the frame keeps room for
 * all of it under its trigger (4px away, plus the 30px the kit keeps from
 * the edge): the auto-resizer grows the frame, and shrinks it back once the
 * menu closes. The kit fills the menu's portal right after setting its ref.
 */
function useMenuRoom(anchor: RefObject<HTMLElement | null>) {
  const openMenu = useRef<HTMLElement | null>(null);

  return useCallback(
    (menu: HTMLDivElement | null) => {
      const root = document.documentElement;
      if (openMenu.current && roomHolder === openMenu.current) {
        roomHolder = null;
        root.style.minHeight = '';
      }
      openMenu.current = menu;
      if (!menu) return;

      queueMicrotask(() => {
        if (!anchor.current || !menu.isConnected) return;
        const panel = menu.querySelector('[role="menu"]') ?? menu;
        const bottom = anchor.current.getBoundingClientRect().bottom;
        roomHolder = menu;
        root.style.minHeight = `${Math.ceil(
          bottom + window.scrollY + 4 + panel.scrollHeight + 30,
        )}px`;
      });
    },
    [anchor],
  );
}

/**
 * One row per page: the path opens the primary (draft) link, the eye opens
 * the page in Visual Editing, and the other links are in a menu.
 */
function PreviewPageRow({
  frontend,
  page,
  links,
  showFrontend,
}: {
  frontend: Frontend;
  page: string;
  links: PreviewLink[];
  /** With several frontends, the row names the one that returned it */
  showFrontend: boolean;
}) {
  const ctx = useCtx();
  // The actions are as tall as the ⋮, so the menu opens under their bottom
  const actions = useRef<HTMLSpanElement>(null);
  const menuRef = useMenuRoom(actions);
  const { showVisualTab } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl;
  const primaryLink = primaryLinkOf(links, draftModeUrl);
  const otherLinks = links.filter((link) => link !== primaryLink);
  // A link to the draft-mode route of a frontend with visual editing opens
  // its page in the Visual Editing tab too
  const visualEditingPath =
    showVisualTab && draftModeUrl
      ? links
          .map(({ url }) =>
            extractRedirectFromDraftModePreviewUrl(url, draftModeUrl),
          )
          .find(Boolean)
      : undefined;

  return (
    <RowList.Item>
      <EntityRow
        layout="row"
        kicker={showFrontend ? frontend.name : undefined}
        title={
          <Tooltip label={`Open ${primaryLink.label}: ${page}`}>
            <a href={primaryLink.url} target="_blank" rel="noreferrer">
              {displayPath(primaryLink.url)}
            </a>
          </Tooltip>
        }
        afterTitle={<OpenInNewTabIcon />}
        trailing={
          <span ref={actions} className={styles.actions}>
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
            {otherLinks.length > 0 && (
              <Dropdown
                triggerComponent={IconTrigger}
                icon={ActionToggleIcon}
                label="More preview links"
              >
                <Dropdown.Menu ref={menuRef} placement="bottom-end">
                  {otherLinks.map((link) => (
                    <Dropdown.Option
                      key={`${link.label}\n${link.url}`}
                      href={link.url}
                      newTab
                      // A menu with one option has no icon
                      icon={
                        otherLinks.length > 1 ? <OpenInNewTabIcon /> : undefined
                      }
                    >
                      {`Open ${link.label} version`}
                    </Dropdown.Option>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
            )}
          </span>
        }
      />
    </RowList.Item>
  );
}

/** The rows of the pages of each frontend, in one list */
export function PreviewPageRows({
  linksByFrontend,
  showFrontend,
  inGroup,
}: {
  linksByFrontend: { frontend: Frontend; previewLinks: PreviewLink[] }[];
  /** Each row names its frontend (with several frontends) */
  showFrontend: boolean;
  /** The list is in a Page.Group, not straight in the frame */
  inGroup?: boolean;
}) {
  return (
    <InsetRowList inGroup={inGroup}>
      {linksByFrontend.flatMap(({ frontend, previewLinks }) =>
        linksByPage(previewLinks).map(([page, links]) => (
          <PreviewPageRow
            key={`${frontend.name}\n${page}`}
            frontend={frontend}
            page={page}
            links={links}
            showFrontend={showFrontend}
          />
        )),
      )}
    </InsetRowList>
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
    return <>{failedLinksNextStep(1)}</>;
  }

  return (
    <>
      {failedLinksNextStepLead(1)}{' '}
      <Link to={pluginSettingsUrl(ctx)}>{PLUGIN_SETTINGS_WORDS}</Link>.
    </>
  );
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
    <PreviewPageRows
      linksByFrontend={[{ frontend, previewLinks: status.previewLinks }]}
      showFrontend={false}
    />
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
      <PreviewPageRows linksByFrontend={linksByFrontend} showFrontend />
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
