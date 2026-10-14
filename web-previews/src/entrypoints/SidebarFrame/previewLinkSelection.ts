import type { Frontend, PreviewLinkWithFrontend } from '../../types';

export type SidebarVisualEditingInfo = {
  alreadyInDraftMode: boolean;
  path: string;
};

function safeRedirectPath(
  redirect: string,
  draftModeUrl: URL,
): string | undefined {
  const url = new URL(redirect, draftModeUrl.origin);

  if (url.origin !== draftModeUrl.origin) {
    return undefined;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Resolves any preview link belonging to a visual-editing frontend to the page
 * path it shows, and whether it is already in draft mode. Published preview links normally
 * point to a disable-draft-mode helper, so checking only for the configured
 * enable route would incorrectly reject fully published records.
 */
export function sidebarVisualEditingInfo(
  link: PreviewLinkWithFrontend | undefined,
  frontend: Frontend | undefined,
): SidebarVisualEditingInfo | undefined {
  const enableDraftModeUrl = frontend?.visualEditing?.enableDraftModeUrl;
  if (!link || !enableDraftModeUrl) {
    return undefined;
  }

  try {
    const previewUrl = new URL(link.url);
    const draftModeUrl = new URL(enableDraftModeUrl);
    const redirect = previewUrl.searchParams.get('redirect');

    const path = redirect
      ? safeRedirectPath(redirect, draftModeUrl)
      : previewUrl.pathname !== draftModeUrl.pathname
        ? `${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`
        : undefined;

    if (!path) {
      return undefined;
    }

    return {
      path,
      // Preview endpoints can use another deployment hostname while sharing
      // the configured draft-mode route. The route itself is what determines
      // whether the iframe has already enabled draft content.
      alreadyInDraftMode:
        previewUrl.pathname === draftModeUrl.pathname && redirect !== null,
    };
  } catch {
    return undefined;
  }
}

function findUpdatedPreviewLink(
  selectedPreviewLink: PreviewLinkWithFrontend,
  previewLinks: PreviewLinkWithFrontend[],
): PreviewLinkWithFrontend | undefined {
  const exactMatch = previewLinks.find(
    (candidate) =>
      candidate.frontendName === selectedPreviewLink.frontendName &&
      candidate.url === selectedPreviewLink.url,
  );

  if (exactMatch) {
    return exactMatch;
  }

  // Preview URLs can legitimately change after saving a routing field. A
  // unique label within the same frontend is the safest available fallback:
  // the endpoint contract does not expose stable IDs or version metadata.
  const labelMatches = previewLinks.filter(
    (candidate) =>
      candidate.frontendName === selectedPreviewLink.frontendName &&
      candidate.label === selectedPreviewLink.label,
  );

  return labelMatches.length === 1 ? labelMatches[0] : undefined;
}

type ReconcilePreviewLinkSelectionOptions = {
  selectedPreviewLink: PreviewLinkWithFrontend | undefined;
  previewLinks: PreviewLinkWithFrontend[];
};

/**
 * Reconciles an existing selection against a refreshed Preview Links response.
 */
export function reconcilePreviewLinkSelection({
  selectedPreviewLink,
  previewLinks,
}: ReconcilePreviewLinkSelectionOptions): PreviewLinkWithFrontend | undefined {
  if (previewLinks.length === 0) {
    return undefined;
  }

  if (!selectedPreviewLink) {
    return previewLinks[0];
  }

  return (
    findUpdatedPreviewLink(selectedPreviewLink, previewLinks) ||
    previewLinks.find(
      (candidate) =>
        candidate.frontendName === selectedPreviewLink.frontendName,
    ) ||
    previewLinks[0]
  );
}
