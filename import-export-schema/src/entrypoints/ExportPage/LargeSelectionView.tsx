import type { SchemaTypes } from '@datocms/cma-client';
import { Button, Spinner, TextField } from 'datocms-react-ui';
import { useId, useMemo, useState } from 'react';
import {
  countCycles,
  findInboundEdges,
  findOutboundEdges,
  getConnectedComponents,
  splitNodesByType,
} from '@/utils/graph/analysis';
import type { Graph } from '@/utils/graph/types';

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
  const searchInputId = useId();
  const [query, setQuery] = useState('');
  const [expandedWhy, setExpandedWhy] = useState<Set<string>>(new Set());

  const initialItemTypeIdSet = useMemo(
    () => new Set(initialItemTypes.map((it) => it.id)),
    [initialItemTypes],
  );

  const { itemTypeNodes, pluginNodes } = useMemo(
    () => splitNodesByType(graph),
    [graph],
  );

  const components = useMemo(() => getConnectedComponents(graph), [graph]);
  const cycles = useMemo(() => countCycles(graph), [graph]);

  const filteredItemTypeNodes = useMemo(() => {
    if (!query) return itemTypeNodes;
    const q = query.toLowerCase();
    return itemTypeNodes.filter((n) => {
      const it = n.data.itemType;
      return (
        it.attributes.name.toLowerCase().includes(q) ||
        it.attributes.api_key.toLowerCase().includes(q)
      );
    });
  }, [itemTypeNodes, query]);

  const filteredPluginNodes = useMemo(() => {
    if (!query) return pluginNodes;
    const q = query.toLowerCase();
    return pluginNodes.filter((n) =>
      n.data.plugin.attributes.name.toLowerCase().includes(q),
    );
  }, [pluginNodes, query]);

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
    const next = new Set(expandedWhy);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedWhy(next);
  }

  const selectedSourceSet = useMemo(
    () => new Set(selectedItemTypeIds.map((id) => `itemType--${id}`)),
    [selectedItemTypeIds],
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          borderBottom: '1px solid var(--border-color)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontWeight: 600 }}>
          {itemTypeNodes.length} models • {pluginNodes.length} plugins •{' '}
          {graph.edges.length} relations
        </div>
        <div style={{ color: 'var(--light-body-color)' }}>
          Components: {components.length} • Cycles: {cycles}
        </div>
        <div style={{ marginLeft: 'auto', minWidth: 260 }}>
          <TextField
            id={searchInputId}
            name="export-search"
            label="Search"
            placeholder="Filter models and plugins"
            value={query}
            onChange={(val) => setQuery(val)}
            textInputProps={{ autoComplete: 'off' }}
          />
        </div>
      </div>

      <div
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}
      >
        <div style={{ flex: 2, padding: 16, overflow: 'auto', minHeight: 0 }}>
          <SectionTitle>Models</SectionTitle>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filteredItemTypeNodes.map((n) => {
              const it = n.data.itemType;
              const locked = initialItemTypeIdSet.has(it.id);
              const checked = selectedItemTypeIds.includes(it.id);
              const inbound = findInboundEdges(graph, `itemType--${it.id}`);
              const outbound = findOutboundEdges(graph, `itemType--${it.id}`);
              const isExpanded = expandedWhy.has(it.id);
              const reasons = findInboundEdges(
                graph,
                `itemType--${it.id}`,
                selectedSourceSet,
              );

              return (
                <li
                  key={it.id}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    padding: '10px 4px',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      aria-label={`Select ${it.attributes.name}`}
                      onChange={() => toggleItemType(it.id)}
                      style={{ width: 16, height: 16 }}
                    />
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontWeight: 600 }}>
                        {it.attributes.name}{' '}
                        <span style={{ color: '#666' }}>
                          (<code>{it.attributes.api_key}</code>)
                        </span>{' '}
                        <span
                          style={{
                            fontSize: 11,
                            color: '#3b82f6',
                            background: 'rgba(59,130,246,0.08)',
                            border: '1px solid rgba(59,130,246,0.25)',
                            borderRadius: 4,
                            padding: '1px 6px',
                            marginLeft: 6,
                          }}
                        >
                          {it.attributes.modular_block ? 'Block' : 'Model'}
                        </span>
                      </div>
                      <div
                        className="hover-relationships"
                        style={{ color: '#666', fontSize: 12, marginTop: 4 }}
                      >
                        <span title="Incoming relations">
                          ← {inbound.length} inbound
                        </span>{' '}
                        •{' '}
                        <span title="Outgoing relations">
                          → {outbound.length} outbound
                        </span>
                      </div>
                    </div>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                    >
                      {reasons.length > 0 && (
                        <Button
                          type="button"
                          buttonType="muted"
                          buttonSize="s"
                          onClick={() => toggleWhy(it.id)}
                        >
                          {isExpanded ? 'Hide why included' : 'Why included?'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {isExpanded && reasons.length > 0 && (
                    <div
                      style={{
                        margin: '8px 0 6px 28px',
                        background: '#fff',
                        border: '1px solid var(--border-color)',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>
                        Included because:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {reasons.map((edge) => {
                          const sourceNode = graph.nodes.find(
                            (nd) => nd.id === edge.source,
                          );
                          if (!sourceNode) return null;
                          const srcIt =
                            sourceNode.type === 'itemType'
                              ? sourceNode.data.itemType
                              : undefined;
                          return (
                            <li key={edge.id} style={{ marginBottom: 6 }}>
                              {srcIt ? (
                                <>
                                  Selected model{' '}
                                  <strong>{srcIt.attributes.name}</strong>{' '}
                                  references it via fields:{' '}
                                  <FieldsList
                                    fields={
                                      (edge.data?.fields ??
                                        []) as SchemaTypes.Field[]
                                    }
                                  />
                                </>
                              ) : (
                                <>
                                  Referenced in fields:{' '}
                                  <FieldsList
                                    fields={
                                      (edge.data?.fields ??
                                        []) as SchemaTypes.Field[]
                                    }
                                  />
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div
          style={{
            flex: 1,
            padding: 16,
            borderLeft: '1px solid var(--border-color)',
            overflow: 'auto',
            minHeight: 0,
          }}
        >
          <SectionTitle>Plugins</SectionTitle>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filteredPluginNodes.map((n) => {
              const pl = n.data.plugin;
              const checked = selectedPluginIds.includes(pl.id);
              const inbound = findInboundEdges(graph, `plugin--${pl.id}`);
              return (
                <li
                  key={pl.id}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    padding: '10px 4px',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`Select ${pl.attributes.name}`}
                      onChange={() => togglePlugin(pl.id)}
                      style={{ width: 16, height: 16 }}
                    />
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontWeight: 600 }}>
                        {pl.attributes.name}
                      </div>
                      <div
                        style={{ color: '#666', fontSize: 12, marginTop: 4 }}
                      >
                        ← {inbound.length} inbound from models
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          padding: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <div style={{ color: '#666', fontSize: 12 }}>
          Graph view hidden due to size.
        </div>
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
        <div style={{ flex: 1 }} />
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
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8, fontWeight: 700, letterSpacing: -0.2 }}>
      {children}
    </div>
  );
}

function FieldsList({ fields }: { fields: SchemaTypes.Field[] }) {
  if (!fields || fields.length === 0) return <em>unknown fields</em>;
  return (
    <>
      {fields
        .map((f) => `${f.attributes.label} (${f.attributes.api_key})`)
        .join(', ')}
    </>
  );
}
