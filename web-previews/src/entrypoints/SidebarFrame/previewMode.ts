import type { Frontend, PreviewLinkWithFrontend } from '../../types';
import {
  hasDraftPreviewLink,
  type SidebarVisualEditingInfo,
  sidebarVisualEditingInfo,
} from './previewLinkSelection';

export type PreviewMode = {
  /** The frontend of the link has a draft-mode route for visual editing */
  frontendHasVisualEditing: boolean;
  /** The visual-editing route of the link, when its frontend has one */
  visualEditing: SidebarVisualEditingInfo | undefined;
  /** The response also has a draft link: this one stays as it is */
  hasDraftAlternative: boolean;
  /** Edit mode is on and the link supports it */
  editModeActive: boolean;
  /** The link that the iframe loads, and that the trigger shows */
  shownPreviewLink: PreviewLinkWithFrontend;
  /** The iframe talks to DatoCMS Content Link */
  connectContentLink: boolean;
};

/**
 * What the sidebar does with the selected link: edit mode needs a frontend
 * with visual editing, and no draft link next to a published one.
 */
export function previewModeOf({
  previewLink,
  previewLinks,
  frontends,
  editModeEnabled,
}: {
  previewLink: PreviewLinkWithFrontend;
  previewLinks: PreviewLinkWithFrontend[];
  frontends: Frontend[];
  editModeEnabled: boolean;
}): PreviewMode {
  const frontend = frontends.find((f) => f.name === previewLink.frontendName);
  const visualEditing = sidebarVisualEditingInfo(previewLink, frontend);
  const hasDraftAlternative = hasDraftPreviewLink(
    previewLink,
    previewLinks,
    frontend,
  );
  const editModeActive = Boolean(
    editModeEnabled && visualEditing && !hasDraftAlternative,
  );

  // Keep the API-provided link selected in the menu, but show the URL that the
  // iframe actually loads while a non-draft preview is made editable.
  const shownPreviewLink =
    editModeActive && visualEditing && !visualEditing.alreadyInDraftMode
      ? {
          ...previewLink,
          label: `Editable preview (from ${previewLink.label})`,
          url: visualEditing.iframeUrl,
        }
      : previewLink;

  return {
    frontendHasVisualEditing: Boolean(
      frontend?.visualEditing?.enableDraftModeUrl,
    ),
    visualEditing,
    hasDraftAlternative,
    editModeActive,
    shownPreviewLink,
    connectContentLink: Boolean(
      visualEditing && (editModeActive || visualEditing.alreadyInDraftMode),
    ),
  };
}

/**
 * Edit mode applies to the sidebar when one of its frontends has visual
 * editing. Without one, the toolbar hides it.
 */
export function editModeApplies(frontends: Frontend[]): boolean {
  return frontends.some((frontend) =>
    Boolean(frontend.visualEditing?.enableDraftModeUrl),
  );
}

/** Why edit mode is not possible for the selected link, if it is not */
export function editModeDisabledReason({
  frontendHasVisualEditing,
  visualEditing,
  hasDraftAlternative,
}: PreviewMode): string | undefined {
  if (hasDraftAlternative) {
    return 'Switch to the draft version to use edit mode.';
  }

  if (!frontendHasVisualEditing) {
    return "This page's frontend doesn't support visual editing.";
  }

  // The link has no page of the website to open in draft mode (for example
  // the draft-mode route itself, with no redirect)
  if (!visualEditing) {
    return "Edit mode can't load this link: it isn't a page of the website.";
  }

  return undefined;
}
