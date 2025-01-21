import { DropdownOption } from 'datocms-react-ui';
import type { PreviewLink } from '../../../../types';
import type { FrontendStatus } from '../../../../utils/common';

export const FrontendPreviewLinks = ({
  status,
  onSelectPreviewLink,
  currentPreviewLink,
}: {
  status: FrontendStatus;
  onSelectPreviewLink: (previewLink: PreviewLink) => void;
  currentPreviewLink: PreviewLink | undefined;
}) => {
  if ('error' in status) {
    return <div>Webhook error: check the console for more info!</div>;
  }

  return (
    <>
      {status.previewLinks.length === 0 ? (
        <DropdownOption>
          No preview links available for this record.
        </DropdownOption>
      ) : (
        status.previewLinks.map((previewLink) => {
          return (
            <DropdownOption
              key={previewLink.url}
              onClick={() => onSelectPreviewLink(previewLink)}
              active={currentPreviewLink?.url === previewLink.url}
            >
              {previewLink.label}
            </DropdownOption>
          );
        })
      )}
    </>
  );
};
