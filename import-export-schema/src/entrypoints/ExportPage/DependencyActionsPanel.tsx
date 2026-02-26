import { faFileExport } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Panel } from '@xyflow/react';
import { Button, Spinner } from 'datocms-react-ui';
import styles from './DependencyActionsPanel.module.css';

type Props = {
  selectingDependencies: boolean;
  areAllDependenciesSelected: boolean;
  selectedItemCount: number;
  onSelectAllDependencies: () => void;
  onUnselectAllDependencies: () => void;
  onExport: () => void;
};

/**
 * Sticky controls rendered over the graph to handle dependency selection + export CTA.
 */
export function DependencyActionsPanel({
  selectingDependencies,
  areAllDependenciesSelected,
  selectedItemCount,
  onSelectAllDependencies,
  onUnselectAllDependencies,
  onExport,
}: Props) {
  return (
    <Panel position="bottom-center">
      <div className={styles.actions}>
        <Button
          type="button"
          buttonSize="m"
          onClick={
            areAllDependenciesSelected
              ? onUnselectAllDependencies
              : onSelectAllDependencies
          }
          disabled={selectingDependencies}
        >
          {areAllDependenciesSelected
            ? 'Unselect all dependencies'
            : 'Select all dependencies'}
        </Button>
        {selectingDependencies && <Spinner size={20} />}

        <Button
          type="button"
          buttonSize="xl"
          buttonType="primary"
          leftIcon={<FontAwesomeIcon icon={faFileExport} />}
          onClick={onExport}
          disabled={selectingDependencies}
        >
          Export {selectedItemCount} elements as JSON
        </Button>
      </div>
    </Panel>
  );
}
