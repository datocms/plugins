import type { SchemaTypes } from '@datocms/cma-client';
import styles from './ExportToolbar.module.css';

type Props = {
  initialItemTypes: SchemaTypes.ItemType[];
};

/**
 * Header bar for the export flow, displaying the active title and close action.
 */
export function ExportToolbar({ initialItemTypes }: Props) {
  const title =
    initialItemTypes.length === 1
      ? `Export ${initialItemTypes[0].attributes.name}`
      : 'Export selection';

  return (
    <div className={styles.toolbar}>
      <div className="page__toolbar__title">{title}</div>
      <div className={styles.spacer} />
    </div>
  );
}
