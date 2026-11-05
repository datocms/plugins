import type { RenderItemFormOutletCtx } from 'datocms-plugin-sdk';
import { Page } from 'datocms-react-ui/Page';
import { useStatusByFrontend } from '../../utils/common';
import { useFrameSizedToContent } from '../../utils/frame';
import { linksByFrontendOf, PreviewPageRows } from '../SidebarPanel';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormOutletCtx;
};

// Only advertises the preview when there is something to open: loading,
// errors and empty results stay silent here (the sidebar panel reports them).
export default function FormPreviewLinks({ ctx }: PropTypes) {
  useFrameSizedToContent();
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);
  const linksByFrontend = statusByFrontend
    ? linksByFrontendOf(frontends, statusByFrontend)
    : [];

  if (linksByFrontend.length === 0) {
    return null;
  }

  return (
    <Page.Group title="Preview links" className={styles.group}>
      <PreviewPageRows
        linksByFrontend={linksByFrontend}
        showFrontend={linksByFrontend.length > 1}
      />
    </Page.Group>
  );
}
