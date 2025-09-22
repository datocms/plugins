import type { SchemaTypes } from '@datocms/cma-client';
import { Button } from 'datocms-react-ui';
import { useContext } from 'react';
import { LargeSelectionLayout } from '@/components/LargeSelectionLayout';
import type { Graph } from '@/utils/graph/types';
import { SelectedEntityContext } from '@/components/SchemaOverview/SelectedEntityContext';
import { LargeSelectionColumns } from '@/components/LargeSelectionColumns';
import sharedStyles from '@/components/LargeSelectionColumns.module.css';
import styles from './LargeSelectionView.module.css';

type Props = {
  graph: Graph;
  onSelect: (entity: SchemaTypes.ItemType | SchemaTypes.Plugin) => void;
};

/**
 * Read-only overview used when the import graph is too dense to render. Mirrors the
 * export-side list but drives the detail sidebar for conflicts.
 */
export default function LargeSelectionView({ graph, onSelect }: Props) {
  const selected = useContext(SelectedEntityContext).entity;
  const handleSelectItemType = (itemType: SchemaTypes.ItemType) => {
    onSelect(itemType);
  };

  const handleSelectPlugin = (plugin: SchemaTypes.Plugin) => {
    onSelect(plugin);
  };

  const isItemTypeSelected = (id: string) =>
    selected?.type === 'item_type' && selected.id === id;

  const isPluginSelected = (id: string) =>
    selected?.type === 'plugin' && selected.id === id;

  return (
    <LargeSelectionLayout
      graph={graph}
      searchLabel="Search"
      searchPlaceholder="Filter models and plugins"
      headerNotice="Graph view is hidden due to size."
      renderContent={({ filteredItemTypeNodes, filteredPluginNodes }) => (
        <LargeSelectionColumns
          graph={graph}
          filteredItemTypeNodes={filteredItemTypeNodes}
          filteredPluginNodes={filteredPluginNodes}
          renderItemTypeRow={({ node, inboundEdges, outboundEdges }) => {
            const itemType = node.data.itemType;
            const selectedRow = isItemTypeSelected(itemType.id);

            return (
              <li key={itemType.id} className={sharedStyles.listItem}>
                <button
                  type="button"
                  className={
                    selectedRow ? styles.rowButtonActive : styles.rowButton
                  }
                  onClick={() => handleSelectItemType(itemType)}
                  onKeyDown={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault();
                    }
                  }}
                  aria-pressed={selectedRow}
                >
                  <div className={styles.rowLayout}>
                    <div className={styles.rowTop}>
                      <div className={styles.entityName}>
                        {itemType.attributes.name}{' '}
                        <span className={sharedStyles.apikey}>
                          (<code>{itemType.attributes.api_key}</code>)
                        </span>{' '}
                        <span className={sharedStyles.badge}>
                          {itemType.attributes.modular_block ? 'Block' : 'Model'}
                        </span>
                      </div>
                      <Button
                        buttonSize="s"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectItemType(itemType);
                        }}
                      >
                        Open details
                      </Button>
                    </div>
                    <div className={sharedStyles.relationships}>
                      <span title="Incoming relations">
                        ← {inboundEdges.length} inbound
                      </span>{' '}
                      •{' '}
                      <span title="Outgoing relations">
                        → {outboundEdges.length} outbound
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          }}
          renderPluginRow={({ node, inboundEdges }) => {
            const plugin = node.data.plugin;
            const selectedRow = isPluginSelected(plugin.id);

            return (
              <li key={plugin.id} className={sharedStyles.listItem}>
                <button
                  type="button"
                  className={
                    selectedRow ? styles.rowButtonActive : styles.rowButton
                  }
                  onClick={() => handleSelectPlugin(plugin)}
                  onKeyDown={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault();
                    }
                  }}
                  aria-pressed={selectedRow}
                >
                  <div className={styles.rowLayout}>
                    <div className={styles.rowTop}>
                      <div className={styles.entityName}>
                        {plugin.attributes.name}
                      </div>
                      <Button
                        buttonSize="s"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectPlugin(plugin);
                        }}
                      >
                        Open details
                      </Button>
                    </div>
                    <div className={sharedStyles.relationships}>
                      ← {inboundEdges.length} inbound from models
                    </div>
                  </div>
                </button>
              </li>
            );
          }}
        />
      )}
    />
  );
}
