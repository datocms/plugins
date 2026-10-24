import { Dropdown } from 'datocms-react-ui/Dropdown';
import EntityRow from 'datocms-react-ui/EntityRow';
import type { Frontend, PreviewLinkWithFrontend } from '../../../types';
import type { FrontendStatus } from '../../../utils/common';
import { PreviewLinkTrigger } from './PreviewLinkTrigger';
import styles from './styles.module.css';

type Props = {
  frontends: Frontend[];
  statusByFrontend: Record<string, FrontendStatus | undefined>;
  /** The link picked in the menu */
  selectedPreviewLink: PreviewLinkWithFrontend;
  /** The link that the iframe loads (the editable version in edit mode) */
  shownPreviewLink: PreviewLinkWithFrontend;
  onChange: (previewLink: PreviewLinkWithFrontend) => void;
};

/** The path of a link, under its label */
function pathOf(url: string) {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}`;
  } catch {
    return url;
  }
}

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
            {pathOf(previewLink.url)}
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
  shownPreviewLink,
  onChange,
}: Props) {
  return (
    // The menu fills its part of the toolbar: its trigger shows the label of
    // the link, then its URL
    <Dropdown
      triggerComponent={PreviewLinkTrigger}
      className={styles.dropdown}
      previewLink={shownPreviewLink}
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
