import {
  faEllipsisV,
  faExternalLinkAlt,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type {
  RenderItemFormOutletCtx,
  RenderItemFormSidebarPanelCtx,
} from 'datocms-plugin-sdk';
import {
  Canvas,
  Dropdown,
  DropdownMenu,
  DropdownOption,
  Spinner,
  useCtx,
} from 'datocms-react-ui';
import type { ReactNode } from 'react';
import { ButtonGroup, ButtonGroupButton } from '../../components/ButtonGroup';
import { PreviewSetupGuide } from '../../components/PreviewSetupGuide';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLink,
} from '../../types';
import { type FrontendStatus, useStatusByFrontend } from '../../utils/common';
import {
  displayPath,
  displayUrl,
  extractRedirectFromDraftModePreviewUrl,
  inspectorUrl,
} from '../../utils/urls';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const FrontendGroup = ({
  status,
  frontend,
  hideIfNoLinks,
}: {
  status: FrontendStatus | undefined;
  frontend: Frontend;
  hideIfNoLinks?: boolean;
}) => {
  if (
    !status ||
    ('previewLinks' in status &&
      status.previewLinks.length === 0 &&
      hideIfNoLinks)
  ) {
    return null;
  }

  return (
    <div className={styles.group}>
      <FrontendResult status={status} frontend={frontend} showFrontendName />
    </div>
  );
};

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

/**
 * One line per page: frontend name, then the path linking to the primary
 * (draft) preview link, with the other links tucked in a menu. Wide containers
 * (the form) keep it on one line; narrow ones (the sidebar panel) stack it.
 */
export const FrontendResult = ({
  status,
  frontend,
  showFrontendName,
}: {
  status: FrontendStatus;
  frontend: Frontend;
  /** Label each row with the frontend (useful with several frontends) */
  showFrontendName?: boolean;
}) => {
  const ctx = useCtx<RenderItemFormSidebarPanelCtx | RenderItemFormOutletCtx>();
  const { showVisualTab } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const draftModeUrl = frontend.visualEditing?.enableDraftModeUrl;
  const prefix = showFrontendName ? `${frontend.name}: ` : '';

  if ('error' in status) {
    return (
      <div>{prefix}API endpoint error: check the console for more info!</div>
    );
  }

  const { previewLinks } = status;

  if (previewLinks.length === 0) {
    return <div>{prefix}No preview links available.</div>;
  }

  const visualEditingPathFor = (urlString: string) =>
    showVisualTab && draftModeUrl
      ? extractRedirectFromDraftModePreviewUrl(urlString, draftModeUrl)
      : undefined;

  const openInVisual = (path: string) => {
    ctx.navigateTo(inspectorUrl(ctx, { path, frontend: frontend.name }));
  };

  const linksByPage = new Map<string, PreviewLink[]>();
  for (const previewLink of previewLinks) {
    const page = displayUrl(previewLink.url);
    linksByPage.set(page, [...(linksByPage.get(page) ?? []), previewLink]);
  }

  return (
    <div className={styles.pages}>
      {[...linksByPage].map(([page, links]) => {
        const visualEditingPath = links
          .map(({ url }) => visualEditingPathFor(url))
          .find(Boolean);
        const primaryLink = primaryLinkOf(links, draftModeUrl);
        const otherLinks = links.filter((link) => link !== primaryLink);
        const visualButton = visualEditingPath && (
          <ButtonGroupButton
            tooltip="Edit in Visual Editing"
            className={styles.compactButton}
            onClick={() => openInVisual(visualEditingPath)}
          >
            <FontAwesomeIcon icon={faEye} />
          </ButtonGroupButton>
        );

        // Draft link, Visual Editing and the menu trigger, joined in one group
        const actions = (moreButton?: ReactNode) => (
          <ButtonGroup className={styles.actions}>
            <a
              href={primaryLink.url}
              target="_blank"
              rel="noreferrer"
              className={styles.page__path}
              title={`Open ${primaryLink.label}: ${page}`}
            >
              <span className={styles.page__pathText}>
                {displayPath(primaryLink.url)}
              </span>
              <FontAwesomeIcon icon={faExternalLinkAlt} />
            </a>
            {visualButton}
            {moreButton}
          </ButtonGroup>
        );

        return (
          <div key={page} className={styles.page}>
            {showFrontendName && (
              <div className={styles.page__frontend} title={frontend.name}>
                {frontend.name}
              </div>
            )}
            <div className={styles.page__main}>
              {otherLinks.length > 0 ? (
                <Dropdown
                  renderTrigger={({ onClick }) =>
                    actions(
                      <ButtonGroupButton
                        tooltip={null}
                        aria-label="More preview links"
                        className={styles.compactButton}
                        onClick={onClick}
                      >
                        <FontAwesomeIcon icon={faEllipsisV} />
                      </ButtonGroupButton>,
                    )
                  }
                >
                  <DropdownMenu alignment="right">
                    {otherLinks.map(({ url, label }) => (
                      <DropdownOption
                        key={url}
                        onClick={() => window.open(url, '_blank', 'noreferrer')}
                      >
                        <span className={styles.menuLink}>
                          Open {label} version
                          <FontAwesomeIcon icon={faExternalLinkAlt} />
                        </span>
                      </DropdownOption>
                    ))}
                  </DropdownMenu>
                </Dropdown>
              ) : (
                actions()
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const PreviewUrl = ({ ctx }: PropTypes) => {
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const firstStatus = statusByFrontend && Object.values(statusByFrontend)[0];

  return (
    <Canvas ctx={ctx}>
      {statusByFrontend ? (
        frontends.length === 0 ? (
          <PreviewSetupGuide compact />
        ) : frontends.length === 1 && firstStatus ? (
          <FrontendResult status={firstStatus} frontend={frontends[0]} />
        ) : Object.values(statusByFrontend).every(
            (status) =>
              !status ||
              ('previewLinks' in status && status.previewLinks.length === 0),
          ) ? (
          <div>No preview links available.</div>
        ) : (
          frontends.map((frontend) => (
            <FrontendGroup
              key={frontend.name}
              frontend={frontend}
              status={statusByFrontend[frontend.name]}
              hideIfNoLinks
            />
          ))
        )
      ) : (
        <Spinner />
      )}
    </Canvas>
  );
};

export default PreviewUrl;
