import { Dropdown } from 'datocms-react-ui/Dropdown';
import EntityRow from 'datocms-react-ui/EntityRow';
import Tooltip from 'datocms-react-ui/Tooltip';
import type { Frontend, PreviewLinkWithFrontend } from '../../../types';
import type { FrontendStatus } from '../../../utils/common';
import { displayPath } from '../../../utils/urls';
import { PreviewLinkText, PreviewLinkTrigger } from './PreviewLinkTrigger';
import styles from './styles.module.css';

type Props = {
  frontends: Frontend[];
  statusByFrontend: Record<string, FrontendStatus | undefined>;
  /** The link picked in the menu */
  selectedPreviewLink: PreviewLinkWithFrontend;
  onChange: (previewLink: PreviewLinkWithFrontend) => void;
};

function hasNoLinks(status: FrontendStatus | undefined) {
  return (
    !status || ('previewLinks' in status && status.previewLinks.length === 0)
  );
}

/** The links of one frontend, or why it has none */
function FrontendOptions({
  frontend,
  status,
  selectedPreviewLink,
  onChange,
}: {
  frontend: Frontend;
  status: FrontendStatus | undefined;
  selectedPreviewLink: PreviewLinkWithFrontend;
  onChange: (previewLink: PreviewLinkWithFrontend) => void;
}) {
  if (status && 'error' in status) {
    return <Dropdown.Text>The preview links didn't load.</Dropdown.Text>;
  }

  return (
    <>
      {status?.previewLinks.map((previewLink) => (
        <Dropdown.Option
          key={`${previewLink.label} ${previewLink.url}`}
          active={
            selectedPreviewLink.frontendName === frontend.name &&
            selectedPreviewLink.url === previewLink.url
          }
          onPick={() =>
            onChange({ ...previewLink, frontendName: frontend.name })
          }
        >
          <EntityRow layout="row" title={previewLink.label}>
            {displayPath(previewLink.url)}
          </EntityRow>
        </Dropdown.Option>
      ))}
    </>
  );
}

/**
 * The menu of the preview links of the record. With several frontends,
 * each one that has links (or failed) is a group.
 */
export function PreviewLinkMenu({
  frontends,
  statusByFrontend,
  selectedPreviewLink,
  onChange,
}: Props) {
  const showFrontendName = frontends.length > 1;

  // A single link (e.g. a model without draft/published): nothing to choose
  const statuses = Object.values(statusByFrontend);
  const linkCount = statuses.reduce(
    (count, status) =>
      count +
      (status && 'previewLinks' in status ? status.previewLinks.length : 0),
    0,
  );
  const hasErrors = statuses.some((status) => status && 'error' in status);

  if (linkCount === 1 && !hasErrors) {
    // The same text in the same place, as plain text: no menu, no chevron
    return (
      <Tooltip label={selectedPreviewLink.url} placement="bottom-start">
        <span className={styles.text}>
          <PreviewLinkText
            previewLink={selectedPreviewLink}
            showFrontendName={showFrontendName}
          />
        </span>
      </Tooltip>
    );
  }

  return (
    // The menu fills its part of the toolbar: its trigger shows the label of
    // the link, then its host and path
    <Dropdown
      triggerComponent={PreviewLinkTrigger}
      className={styles.dropdown}
      previewLink={selectedPreviewLink}
      showFrontendName={showFrontendName}
    >
      <Dropdown.Menu optionPaddingY={6}>
        {frontends.length === 1 ? (
          <FrontendOptions
            frontend={frontends[0]}
            status={statusByFrontend[frontends[0].name]}
            selectedPreviewLink={selectedPreviewLink}
            onChange={onChange}
          />
        ) : (
          frontends.map((frontend) => {
            const status = statusByFrontend[frontend.name];

            if (hasNoLinks(status)) {
              return null;
            }

            return (
              <Dropdown.Group key={frontend.name} name={frontend.name}>
                <FrontendOptions
                  frontend={frontend}
                  status={status}
                  selectedPreviewLink={selectedPreviewLink}
                  onChange={onChange}
                />
              </Dropdown.Group>
            );
          })
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
}
