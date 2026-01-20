import { DropdownGroup } from 'datocms-react-ui';
import type { Frontend, PreviewLinkWithFrontend } from '../../../../types';
import type { FrontendStatus } from '../../../../utils/common';
import { FrontendPreviewLinks } from '../FrontendPreviewLinks';

export const FrontendGroup = ({
  status,
  frontend,
  hideIfNoLinks,
  onSelectPreviewLink,
  currentPreviewLink,
}: {
  status: FrontendStatus | undefined;
  frontend: Frontend;
  hideIfNoLinks?: boolean;
  currentPreviewLink: PreviewLinkWithFrontend | undefined;
  onSelectPreviewLink: (previewLink: PreviewLinkWithFrontend) => void;
}) => {
  if (
    (!status ||
      ('previewLinks' in status && status.previewLinks.length === 0)) &&
    hideIfNoLinks
  ) {
    return null;
  }

  return (
    <DropdownGroup name={frontend.name}>
      <FrontendPreviewLinks
        status={status}
        frontend={frontend}
        onSelectPreviewLink={onSelectPreviewLink}
        currentPreviewLink={currentPreviewLink}
      />
    </DropdownGroup>
  );
};
