import isEqual from 'lodash-es/isEqual';
import { useCallback, useMemo, useState } from 'react';
import type { PreviewLinkWithFrontend } from '../../types';
import type { FrontendStatus } from '../../utils/common';
import {
  findRequestedPreviewLink,
  type RequestedPreviewLink,
  reconcilePreviewLinkSelection,
} from './previewLinkSelection';

type PreviewLinkSelection = {
  previewLinks: PreviewLinkWithFrontend[];
  selectedPreviewLink: PreviewLinkWithFrontend | undefined;
  /** The request that the selection answered: it is not applied twice */
  appliedRequest: RequestedPreviewLink | undefined;
};

const EMPTY_SELECTION: PreviewLinkSelection = {
  previewLinks: [],
  selectedPreviewLink: undefined,
  appliedRequest: undefined,
};

/**
 * The preview link that the sidebar shows. The first link is selected by
 * default; each refreshed response keeps the selection of the user (see
 * reconcilePreviewLinkSelection). A requested link (see
 * `requestedPreviewLinkOf`) is selected once, as soon as a response has it:
 * the user can then pick another link.
 */
export function usePreviewLinkSelection({
  statusByFrontend,
  requested,
}: {
  statusByFrontend: Record<string, FrontendStatus | undefined> | undefined;
  requested: RequestedPreviewLink | undefined;
}) {
  const previewLinks = useMemo(() => {
    if (!statusByFrontend) return [];

    return Object.entries(statusByFrontend).flatMap(
      ([frontendName, status]) => {
        if (status && 'previewLinks' in status) {
          return status.previewLinks.map((link) => ({
            ...link,
            frontendName,
          }));
        }
        return [];
      },
    );
  }, [statusByFrontend]);

  const [selection, setSelection] =
    useState<PreviewLinkSelection>(EMPTY_SELECTION);

  let synchronizedSelection = selection;

  // The host sends the parameters again on each change of the form: only a
  // request with new content is a new request
  const requestedLink =
    requested && !isEqual(requested, selection.appliedRequest)
      ? findRequestedPreviewLink(requested, previewLinks)
      : undefined;

  if (selection.previewLinks !== previewLinks || requestedLink) {
    synchronizedSelection = {
      previewLinks,
      selectedPreviewLink:
        requestedLink ??
        reconcilePreviewLinkSelection({
          selectedPreviewLink: selection.selectedPreviewLink,
          previewLinks,
        }),
      appliedRequest: requestedLink ? requested : selection.appliedRequest,
    };

    // Guarded render-time synchronization makes React rerender this component
    // before committing its children. The iframe therefore never sees a
    // stale selection after the Preview Links response changes.
    setSelection(synchronizedSelection);
  }

  const selectPreviewLink = useCallback(
    (selectedPreviewLink: PreviewLinkWithFrontend) => {
      // Remember which response the manual selection came from.
      setSelection((current) => ({
        ...current,
        previewLinks,
        selectedPreviewLink,
      }));
    },
    [previewLinks],
  );

  return {
    selectedPreviewLink: synchronizedSelection.selectedPreviewLink,
    selectPreviewLink,
  };
}
