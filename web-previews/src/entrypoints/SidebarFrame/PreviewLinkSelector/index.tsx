import { Dropdown, DropdownMenu, DropdownOption } from 'datocms-react-ui';
import type { Frontend, PreviewLink } from '../../../types';
import type { FrontendStatus } from '../../../utils/common';
import { FrontendGroup } from './FrontendGroup';
import { FrontendPreviewLinks } from './FrontendPreviewLinks';
import { Trigger } from './Trigger';

type Props = {
  currentPreviewLink: PreviewLink | undefined;
  frontends: Frontend[];
  statusByFrontend: Record<string, FrontendStatus>;
  onChange: (previewLink: PreviewLink) => void;
};

export function PreviewLinkSelector({
  frontends,
  statusByFrontend,
  currentPreviewLink,
  onChange,
}: Props) {
  return (
    <Dropdown
      renderTrigger={(props) => (
        <Trigger {...props} currentPreviewLink={currentPreviewLink} />
      )}
    >
      <DropdownMenu>
        {frontends.length === 0 ? (
          <div>No frontends configured!</div>
        ) : frontends.length === 1 ? (
          <FrontendPreviewLinks
            status={Object.values(statusByFrontend)[0]}
            currentPreviewLink={currentPreviewLink}
            onSelectPreviewLink={onChange}
          />
        ) : Object.values(statusByFrontend).every(
            (status) =>
              'previewLinks' in status && status.previewLinks.length === 0,
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
