import { Dropdown, DropdownMenu, DropdownOption } from 'datocms-react-ui';
import type { Frontend, PreviewLinkWithFrontend } from '../../../types';
import type { FrontendStatus } from '../../../utils/common';
import { FrontendGroup } from './FrontendGroup';
import { FrontendPreviewLinks } from './FrontendPreviewLinks';
import { Trigger } from './Trigger';

type Props = {
  currentPreviewLink: PreviewLinkWithFrontend | undefined;
  frontends: Frontend[];
  statusByFrontend: Record<string, FrontendStatus | undefined>;
  onChange: (previewLink: PreviewLinkWithFrontend) => void;
};

export function PreviewLinkSelector({
  frontends,
  statusByFrontend,
  currentPreviewLink,
  onChange,
}: Props) {
  const firstStatus = Object.values(statusByFrontend)[0];

  return (
    <Dropdown
      renderTrigger={(props) => (
        <Trigger {...props} currentPreviewLink={currentPreviewLink} />
      )}
    >
      <DropdownMenu>
        {frontends.length === 0 ? (
          <div>No frontends configured!</div>
        ) : frontends.length === 1 && firstStatus ? (
          <FrontendPreviewLinks
            status={firstStatus}
            frontend={frontends[0]}
            currentPreviewLink={currentPreviewLink}
            onSelectPreviewLink={onChange}
          />
        ) : Object.values(statusByFrontend).every(
            (status) =>
              !status ||
              ('previewLinks' in status && status.previewLinks.length === 0),
          ) ? (
          <DropdownOption>
            No preview links available for this record.
          </DropdownOption>
        ) : (
          frontends.map((frontend) => (
            <FrontendGroup
              key={frontend.name}
              frontend={frontend}
              status={statusByFrontend[frontend.name]}
              hideIfNoLinks
              currentPreviewLink={currentPreviewLink}
              onSelectPreviewLink={onChange}
            />
          ))
        )}
      </DropdownMenu>
    </Dropdown>
  );
}
