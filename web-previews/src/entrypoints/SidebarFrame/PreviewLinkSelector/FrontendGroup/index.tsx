import { DropdownGroup } from 'datocms-react-ui';
import type { Frontend, PreviewLink } from '../../../../types';
import type { FrontendStatus } from '../../../../utils/common';
import { FrontendPreviewLinks } from '../FrontendPreviewLinks';

export const FrontendGroup = ({
  status,
  frontend,
  hideIfNoLinks,
  onSelectPreviewLink,
  currentPreviewLink,
}: {
  status: FrontendStatus;
  frontend: Frontend;
  hideIfNoLinks?: boolean;
  currentPreviewLink: PreviewLink | undefined;
  onSelectPreviewLink: (previewLink: PreviewLink) => void;
}) => {
  if (
    'previewLinks' in status &&
    status.previewLinks.length === 0 &&
    hideIfNoLinks
  ) {
    return null;
  }

  return (
    <DropdownGroup name={frontend.name}>
      <FrontendPreviewLinks
        status={status}
        onSelectPreviewLink={onSelectPreviewLink}
        currentPreviewLink={currentPreviewLink}
      />
    </DropdownGroup>
  );
};
