import type { SchemaTypes } from '@datocms/cma-client';
import { Button, Spinner } from 'datocms-react-ui';
import { useMemo, useState } from 'react';
import { findInboundEdges } from '@/utils/graph/analysis';
import { LargeSelectionLayout } from '@/components/LargeSelectionLayout';
import type { Graph } from '@/utils/graph/types';
import { LargeSelectionColumns } from '@/components/LargeSelectionColumns';
import sharedStyles from '@/components/LargeSelectionColumns.module.css';
import styles from './LargeSelectionView.module.css';

type Props = {
  initialItemTypes: SchemaTypes.ItemType[];
  graph: Graph;
  selectedItemTypeIds: string[];
  setSelectedItemTypeIds: (next: string[]) => void;
  selectedPluginIds: string[];
  setSelectedPluginIds: (next: string[]) => void;
  onExport: (itemTypeIds: string[], pluginIds: string[]) => void;
  onSelectAllDependencies: () => Promise<void> | void;
  onUnselectAllDependencies: () => Promise<void> | void;
  areAllDependenciesSelected: boolean;
  selectingDependencies: boolean;
};

/**
 * List-based fallback for very large graphs. Provides search, metrics, and dependency
 * context so the user retains insight when the canvas is hidden.
 */
export default function LargeSelectionView({
  initialItemTypes,
  graph,
  selectedItemTypeIds,
  setSelectedItemTypeIds,
  selectedPluginIds,
  setSelectedPluginIds,
  onExport,
  onSelectAllDependencies,
  onUnselectAllDependencies,
  areAllDependenciesSelected,
  selectingDependencies,
}: Props) {
  const [expandedWhy, setExpandedWhy] = useState<Set<string>>(new Set());

  const initialItemTypeIdSet = useMemo(
    () => new Set(initialItemTypes.map((it) => it.id)),
    [initialItemTypes],
  );

  const selectedSourceSet = useMemo(
    () => new Set(selectedItemTypeIds.map((id) => `itemType--${id}`)),
    [selectedItemTypeIds],
  );

  function toggleItemType(id: string) {
    setSelectedItemTypeIds(
      selectedItemTypeIds.includes(id)
        ? selectedItemTypeIds.filter((x) => x !== id)
        : [...selectedItemTypeIds, id],
    );
  }

  function togglePlugin(id: string) {
    setSelectedPluginIds(
      selectedPluginIds.includes(id)
        ? selectedPluginIds.filter((x) => x !== id)
        : [...selectedPluginIds, id],
    );
  }

  function toggleWhy(id: string) {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <LargeSelectionLayout
      graph={graph}
      searchLabel="Search"
      searchPlaceholder="Filter models and plugins"
      renderContent={({ filteredItemTypeNodes, filteredPluginNodes }) => (
        <LargeSelectionColumns
          graph={graph}
          filteredItemTypeNodes={filteredItemTypeNodes}
          filteredPluginNodes={filteredPluginNodes}
          renderItemTypeRow={({ node, inboundEdges, outboundEdges }) => {
            const itemType = node.data.itemType;
            const locked = initialItemTypeIdSet.has(itemType.id);
            const checked = selectedItemTypeIds.includes(itemType.id);
            const isExpanded = expandedWhy.has(itemType.id);
            const reasons = findInboundEdges(
              graph,
              `itemType--${itemType.id}`,
              selectedSourceSet,
            );

            return (
              <li key={itemType.id} className={sharedStyles.listItem}>
                <div className={styles.modelRow}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    aria-label={`Select ${itemType.attributes.name}`}
                    onChange={() => toggleItemType(itemType.id)}
                    className={styles.checkbox}
                  />
                  <div className={styles.modelInfo}>
                    <div className={styles.modelTitle}>
                      {itemType.attributes.name}{' '}
                      <span className={sharedStyles.apikey}>
                        (<code>{itemType.attributes.api_key}</code>)
                      </span>{' '}
                      <span className={sharedStyles.badge}>
                        {itemType.attributes.modular_block ? 'Block' : 'Model'}
                      </span>
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
                  <div className={styles.actions}>
                    {reasons.length > 0 ? (
                      <Button
                        type="button"
                        buttonType="muted"
                        buttonSize="s"
                        onClick={() => toggleWhy(itemType.id)}
                      >
                        {isExpanded ? 'Hide why included' : 'Why included?'}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {isExpanded && reasons.length > 0 ? (
                  <div className={styles.whyPanel}>
                    <div className={styles.whyTitle}>Included because:</div>
                    <ul className={styles.whyList}>
                      {reasons.map((edge) => {
                        const sourceNode = graph.nodes.find(
                          (nd) => nd.id === edge.source,
                        );
                        if (!sourceNode) return null;
                        const sourceItemType =
                          sourceNode.type === 'itemType'
                            ? sourceNode.data.itemType
                            : undefined;
                        return (
                          <li key={edge.id} className={styles.whyListItem}>
                            {sourceItemType ? (
                              <>
                                Selected model{' '}
                                <strong>
                                  {sourceItemType.attributes.name}
                                </strong>{' '}
                                references it via fields:{' '}
                                <FieldsList
                                  fields={
                                    (edge.data?.fields ?? []) as SchemaTypes.Field[]
                                  }
                                />
                              </>
                            ) : (
                              <>
                                Referenced in fields:{' '}
                                <FieldsList
                                  fields={
                                    (edge.data?.fields ?? []) as SchemaTypes.Field[]
                                  }
                                />
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          }}
          renderPluginRow={({ node, inboundEdges }) => {
            const plugin = node.data.plugin;
            const checked = selectedPluginIds.includes(plugin.id);

            return (
              <li key={plugin.id} className={sharedStyles.listItem}>
                <div className={styles.pluginRow}>
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`Select ${plugin.attributes.name}`}
                    onChange={() => togglePlugin(plugin.id)}
                    className={styles.checkbox}
                  />
                  <div className={styles.pluginInfo}>
                    <div className={styles.modelTitle}>{plugin.attributes.name}</div>
                    <div className={sharedStyles.relationships}>
                      ← {inboundEdges.length} inbound from models
                    </div>
                  </div>
                </div>
              </li>
            );
          }}
        />
      )}
      renderFooter={() => (
        <div className={styles.footerRow}>
          <div className={styles.footerNotice}>Graph view hidden due to size.</div>
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
          {selectingDependencies ? <Spinner size={20} /> : null}
          <div className={styles.footerSpacer} />
          <Button
            type="button"
            buttonSize="xl"
            buttonType="primary"
            onClick={() => onExport(selectedItemTypeIds, selectedPluginIds)}
            disabled={selectingDependencies}
          >
            Export {selectedItemTypeIds.length} elements as JSON
          </Button>
        </div>
      )}
    />
  );
}

function FieldsList({ fields }: { fields: SchemaTypes.Field[] }) {
  if (!fields || fields.length === 0) return <em>unknown fields</em>;
  return (
    <>
      {fields
        .map((field) => `${field.attributes.label} (${field.attributes.api_key})`)
        .join(', ')}
    </>
  );
}
