import type { PreviewLink } from '../../types';
import {
  displayUrl,
  extractRedirectFromDraftModePreviewUrl,
} from '../../utils/urls';

/**
 * The link the path opens: the draft-mode one when we can tell (by the
 * frontend's draft mode URL, then by label), otherwise the first.
 */
export function primaryLinkOf(
  links: PreviewLink[],
  draftModeUrl: string | undefined,
) {
  return (
    links.find(
      ({ url }) =>
        draftModeUrl &&
        extractRedirectFromDraftModePreviewUrl(url, draftModeUrl) !== undefined,
    ) ??
    links.find(({ label }) => /draft/i.test(label)) ??
    links[0]
  );
}

/** Groups links by the page they show (host + path), keeping response order. */
export function groupLinksByPage(previewLinks: PreviewLink[]) {
  const linksByPage = new Map<string, PreviewLink[]>();
  for (const previewLink of previewLinks) {
    const page = displayUrl(previewLink.url);
    linksByPage.set(page, [...(linksByPage.get(page) ?? []), previewLink]);
  }
  return linksByPage;
}
