import { useCallback, useMemo, useState } from 'react';
import type { Frontend, PreviewLinkWithFrontend } from '../../types';
import type { FrontendStatus } from '../../utils/common';
import { reconcilePreviewLinkSelection } from './previewLinkSelection';

type PreviewLinkSelection = {
  previewLinks: PreviewLinkWithFrontend[];
  selectedPreviewLink: PreviewLinkWithFrontend | undefined;
};

const EMPTY_SELECTION: PreviewLinkSelection = {
  previewLinks: [],
  selectedPreviewLink: undefined,
};

/**
 * The preview link that the sidebar shows. The first link is selected by
 * default; each refreshed response keeps the selection of the user (see
 * reconcilePreviewLinkSelection).
 */
export function usePreviewLinkSelection({
  statusByFrontend,
  frontends,
  editModeEnabled,
}: {
  statusByFrontend: Record<string, FrontendStatus | undefined> | undefined;
  frontends: Frontend[];
  editModeEnabled: boolean;
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

  if (selection.previewLinks !== previewLinks) {
    synchronizedSelection = {
      previewLinks,
      selectedPreviewLink: reconcilePreviewLinkSelection({
        selectedPreviewLink: selection.selectedPreviewLink,
        previousPreviewLinks: selection.previewLinks,
        previewLinks,
        frontends,
        editModeEnabled,
      }),
    };

    // Guarded render-time synchronization makes React rerender this component
    // before committing its children. The iframe therefore never sees the
    // stale Published selection after a real Draft link appears.
    setSelection(synchronizedSelection);
  }

  const selectPreviewLink = useCallback(
    (selectedPreviewLink: PreviewLinkWithFrontend) => {
      // Remember which response the manual selection came from. If Published
      // is chosen while Draft already exists, later refreshes must preserve it.
      setSelection({ previewLinks, selectedPreviewLink });
    },
    [previewLinks],
  );

  return {
    previewLinks,
    selectedPreviewLink: synchronizedSelection.selectedPreviewLink,
    selectPreviewLink,
  };
}
