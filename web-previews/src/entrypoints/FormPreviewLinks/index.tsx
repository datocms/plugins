import type { RenderItemFormOutletCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useStatusByFrontend } from '../../utils/common';
import { FrontendResult } from '../SidebarPanel';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderItemFormOutletCtx;
};

// Only advertises the preview when there is something to open: loading,
// errors and empty results stay silent here (the sidebar panel reports them).
const FormPreviewLinks = ({ ctx }: PropTypes) => {
  const [frontends, statusByFrontend] = useStatusByFrontend(ctx);

  const frontendsWithLinks = frontends.filter((frontend) => {
    const status = statusByFrontend?.[frontend.name];
    return status && 'previewLinks' in status && status.previewLinks.length > 0;
  });

  return (
    <Canvas ctx={ctx}>
      {frontendsWithLinks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.title}>Preview links</div>
          {frontendsWithLinks.map((frontend) => {
            const status = statusByFrontend?.[frontend.name];
            if (!status) return null;

            return (
              <div key={frontend.name} className={styles.group}>
                <FrontendResult
                  status={status}
                  frontend={frontend}
                  showFrontendName={frontendsWithLinks.length > 1}
                />
              </div>
            );
          })}
        </div>
      )}
    </Canvas>
  );
};

export default FormPreviewLinks;
