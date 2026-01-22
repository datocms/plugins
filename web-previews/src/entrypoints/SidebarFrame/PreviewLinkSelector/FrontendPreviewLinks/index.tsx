import { DropdownOption } from 'datocms-react-ui';
import type { Frontend, PreviewLinkWithFrontend } from '../../../../types';
import type { FrontendStatus } from '../../../../utils/common';

export const FrontendPreviewLinks = ({
  status,
  frontend,
  onSelectPreviewLink,
  currentPreviewLink,
}: {
  status: FrontendStatus | undefined;
  frontend: Frontend;
  onSelectPreviewLink: (previewLink: PreviewLinkWithFrontend) => void;
  currentPreviewLink: PreviewLinkWithFrontend | undefined;
}) => {
  if (status && 'error' in status) {
    return <div>API endpoint error: check the console for more info!</div>;
  }

  return (
    <>
      {!status || status.previewLinks.length === 0 ? (
        <DropdownOption>
          No preview links available for this record.
        </DropdownOption>
      ) : (
        status.previewLinks.map((previewLink) => {
          const previewLinkWithFrontend: PreviewLinkWithFrontend = {
            ...previewLink,
            frontendName: frontend.name,
          };
          return (
            <DropdownOption
              key={previewLink.url}
              onClick={() => onSelectPreviewLink(previewLinkWithFrontend)}
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
