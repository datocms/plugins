import type { Frontend, PreviewLinkWithFrontend } from '../../types';

export type SidebarVisualEditingInfo = {
  iframeUrl: string;
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
 * Resolves any preview link belonging to a visual-editing frontend to a URL
 * that enables draft mode for the same page. Published preview links normally
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

    draftModeUrl.searchParams.set('redirect', path);

    return {
      iframeUrl: draftModeUrl.toString(),
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

/**
 * Finds the real draft preview corresponding to a published preview. Matching
 * uses frontend and redirect path instead of labels, which are user-defined.
 */
export function findMatchingDraftPreviewLink(
  link: PreviewLinkWithFrontend | undefined,
  links: PreviewLinkWithFrontend[],
  frontend: Frontend | undefined,
): PreviewLinkWithFrontend | undefined {
  const currentInfo = sidebarVisualEditingInfo(link, frontend);

  if (!link || !currentInfo || currentInfo.alreadyInDraftMode) {
    return undefined;
  }

  return links.find((candidate) => {
    if (candidate.frontendName !== link.frontendName) {
      return false;
    }

    const candidateInfo = sidebarVisualEditingInfo(candidate, frontend);

    return Boolean(
      candidateInfo?.alreadyInDraftMode &&
        candidateInfo.path === currentInfo.path,
    );
  });
}

function findSoleDraftPreviewLink(
  links: PreviewLinkWithFrontend[],
  frontend: Frontend | undefined,
  frontendName: string,
): PreviewLinkWithFrontend | undefined {
  const draftLinks = links.filter((candidate) => {
    if (candidate.frontendName !== frontendName) {
      return false;
    }

    return sidebarVisualEditingInfo(candidate, frontend)?.alreadyInDraftMode;
  });

  return draftLinks.length === 1 ? draftLinks[0] : undefined;
}

/**
 * A published preview must stay published when the API also returned a draft
 * preview for the same page. Deriving an editable URL is only a fallback for
 * records whose published preview is the sole available version.
 */
export function hasDraftPreviewLink(
  link: PreviewLinkWithFrontend | undefined,
  links: PreviewLinkWithFrontend[],
  frontend: Frontend | undefined,
): boolean {
  const currentInfo = sidebarVisualEditingInfo(link, frontend);

  if (!link || !currentInfo || currentInfo.alreadyInDraftMode) {
    return false;
  }

  // Version availability belongs to the record, not to one particular route.
  // A slug edit can make the Draft and Published paths differ, but Published
  // still must not become editable while this frontend exposes a Draft option.
  return links.some(
    (candidate) =>
      candidate.frontendName === link.frontendName &&
      sidebarVisualEditingInfo(candidate, frontend)?.alreadyInDraftMode,
  );
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
  previousPreviewLinks: PreviewLinkWithFrontend[];
  previewLinks: PreviewLinkWithFrontend[];
  frontends: Frontend[];
  editModeEnabled: boolean;
};

/**
 * Reconciles an existing selection against a refreshed Preview Links response.
 *
 * The important transition is a published-only record becoming updated while
 * its derived editable preview is open. In that case a real draft link has just
 * appeared, so select that exact link synchronously. This keeps the dropdown,
 * iframe and Edit mode aligned without rendering the published `/disable` URL
 * in between. A manually selected Published link is left alone when the prior
 * response already contained its matching Draft link.
 */
export function reconcilePreviewLinkSelection({
  selectedPreviewLink,
  previousPreviewLinks,
  previewLinks,
  frontends,
  editModeEnabled,
}: ReconcilePreviewLinkSelectionOptions): PreviewLinkWithFrontend | undefined {
  if (previewLinks.length === 0) {
    return undefined;
  }

  if (!selectedPreviewLink) {
    return previewLinks[0];
  }

  const frontend = frontends.find(
    (candidate) => candidate.name === selectedPreviewLink.frontendName,
  );
  const selectedInfo = sidebarVisualEditingInfo(
    selectedPreviewLink,
    frontend,
  );
  const selectedWasEditablePublishedOnly = Boolean(
    editModeEnabled &&
      previousPreviewLinks.length > 0 &&
      selectedInfo &&
      !selectedInfo.alreadyInDraftMode &&
      !hasDraftPreviewLink(
        selectedPreviewLink,
        previousPreviewLinks,
        frontend,
      ),
  );

  const updatedSelectedPreviewLink = findUpdatedPreviewLink(
    selectedPreviewLink,
    previewLinks,
  );

  if (selectedWasEditablePublishedOnly) {
    const matchingDraft = findMatchingDraftPreviewLink(
      updatedSelectedPreviewLink || selectedPreviewLink,
      previewLinks,
      frontend,
    );

    if (matchingDraft) {
      return matchingDraft;
    }

    // Saving the edit that creates the Draft may also change the page route
    // (for example, by editing its slug). If there is one unambiguous Draft
    // link for this frontend, it is the successor even though its path differs.
    const soleDraft = findSoleDraftPreviewLink(
      previewLinks,
      frontend,
      selectedPreviewLink.frontendName,
    );

    if (soleDraft) {
      return soleDraft;
    }
  }

  return (
    updatedSelectedPreviewLink ||
    previewLinks.find(
      (candidate) =>
        candidate.frontendName === selectedPreviewLink.frontendName,
    ) ||
    previewLinks[0]
  );
}
