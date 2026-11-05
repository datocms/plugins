import type { RenderItemFormOutletCtx } from 'datocms-plugin-sdk';
import { Page } from 'datocms-react-ui/Page';
import { useCallback } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import {
  type Frontend,
  normalizeParameters,
  type Parameters,
  type PreviewLink,
} from '../../types';
import { useStatusByFrontend } from '../../utils/common';
import { useFrameSizedToContent } from '../../utils/frame';
import { linksByFrontendOf, PreviewLinkRows } from '../SidebarPanel';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormOutletCtx;
};

/**
 * Asks the host to show the Website preview sidebar with this link. The
 * sidebar reads the parameters (see `requestedPreviewLinkOf`).
 */
function usePreviewInSidebar(ctx: RenderItemFormOutletCtx) {
  const { previewLinksSidebar } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  const previewInSidebar = useCallback(
    (link: PreviewLink, frontend: Frontend) => {
      ctx.openItemFormSidebar('webPreviews', {
        parameters: {
          frontend: frontend.name,
          url: link.url,
          // The sidebar shows the link again when the user asks the same
          // link after a pick of another one
          openedAt: Date.now(),
        },
      });
    },
    [ctx.openItemFormSidebar],
  );

  // Without the sidebar there is nothing to open
  return previewLinksSidebar ? previewInSidebar : undefined;
}

// Every marketplace plugin shares the origin of the plugins CDN, so the key
// starts with the name of the plugin. The pick is of the user, the same in
// every project.
const OPEN_STORAGE_KEY = 'web-previews.formPreviewLinksOpen';

// Only advertises the preview when there is something to open: loading,
// errors and empty results stay silent here (the sidebar panel reports them).
export default function FormPreviewLinks({ ctx }: PropTypes) {
  useFrameSizedToContent();
  const [open, setOpen] = useLocalStorage(OPEN_STORAGE_KEY, true);
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const linksByFrontend = statusByFrontend
    ? linksByFrontendOf(frontends, statusByFrontend)
    : [];
  const previewInSidebar = usePreviewInSidebar(ctx);

  if (linksByFrontend.length === 0) {
    return null;
  }

  const linksCount = linksByFrontend.reduce(
    (count, { previewLinks }) => count + previewLinks.length,
    0,
  );

  return (
    <Page.Group
      title="Preview links"
      className={styles.group}
      collapse={{ open, onToggle: () => setOpen(!open) }}
      // The closed group tells how many links it hides
      count={open ? undefined : linksCount}
    >
      <PreviewLinkRows
        linksByFrontend={linksByFrontend}
        showFrontend={linksByFrontend.length > 1}
        onPreviewInSidebar={previewInSidebar}
      />
    </Page.Group>
  );
}
