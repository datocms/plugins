import type { SchemaTypes } from '@datocms/cma-client';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button } from 'datocms-react-ui';
import styles from './ExportToolbar.module.css';

type Props = {
  ctx: RenderPageCtx;
  initialItemTypes: SchemaTypes.ItemType[];
  onClose?: () => void;
};

/**
 * Header bar for the export flow, displaying the active title and close action.
 */
export function ExportToolbar({ ctx, initialItemTypes, onClose }: Props) {
  const title =
    initialItemTypes.length === 1
      ? `Export ${initialItemTypes[0].attributes.name}`
      : 'Export selection';

  return (
    <div className={styles.toolbar}>
      <div className="page__toolbar__title">{title}</div>
      <div className={styles.spacer} />
      <Button
        leftIcon={<FontAwesomeIcon icon={faXmark} />}
        buttonSize="s"
        onClick={() => {
          if (onClose) {
            onClose();
            return;
          }
          ctx.navigateTo(
            `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/export`,
          );
        }}
      >
        Close
      </Button>
    </div>
  );
}
