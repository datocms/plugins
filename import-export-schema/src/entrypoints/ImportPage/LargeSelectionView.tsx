import type { SchemaTypes } from '@datocms/cma-client';
import { Button, TextField } from 'datocms-react-ui';
import { useContext, useId, useMemo, useState } from 'react';
import {
  countCycles,
  findInboundEdges,
  findOutboundEdges,
  getConnectedComponents,
  splitNodesByType,
} from '@/utils/graph/analysis';
import type { Graph } from '@/utils/graph/types';
import { SelectedEntityContext } from './SelectedEntityContext';

type Props = {
  graph: Graph;
  onSelect: (entity: SchemaTypes.ItemType | SchemaTypes.Plugin) => void;
};

export default function LargeSelectionView({ graph, onSelect }: Props) {
  const searchInputId = useId();
  const [query, setQuery] = useState('');
  const selected = useContext(SelectedEntityContext).entity;

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
        <div
          style={{
            borderBottom: '1px solid var(--border-color)',
            padding: '0px 0px 8px 0px',
            fontSize: 12,
            color: '#666',
          }}
        >
          Graph view is hidden due to size.
        </div>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <TextField
            id={searchInputId}
            name="import-search"
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
              const inbound = findInboundEdges(graph, `itemType--${it.id}`);
              const outbound = findOutboundEdges(graph, `itemType--${it.id}`);
              const isSelected =
                selected?.type === 'item_type' && selected.id === it.id;

              return (
                <li
                  key={it.id}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    padding: '10px 4px',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(it)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(it);
                      }
                    }}
                    style={{
                      border: 0,
                      background: isSelected
                        ? 'rgba(51, 94, 234, 0.08)'
                        : 'transparent',
                      borderRadius: 6,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 8px',
                      cursor: 'pointer',
                    }}
                    aria-pressed={isSelected}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
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
                      <div>
                        <Button
                          buttonSize="s"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(it);
                          }}
                        >
                          Open details
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <SectionTitle>Plugins</SectionTitle>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filteredPluginNodes.map((n) => {
              const pl = n.data.plugin;
              const inbound = findInboundEdges(graph, `plugin--${pl.id}`);
              const isSelected =
                selected?.type === 'plugin' && selected.id === pl.id;

              return (
                <li
                  key={pl.id}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    padding: '10px 4px',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(pl)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(pl);
                      }
                    }}
                    style={{
                      border: 0,
                      background: isSelected
                        ? 'rgba(51, 94, 234, 0.08)'
                        : 'transparent',
                      borderRadius: 6,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 8px',
                      cursor: 'pointer',
                    }}
                    aria-pressed={isSelected}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
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
                      <div>
                        <Button
                          buttonSize="s"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(pl);
                          }}
                        >
                          Open details
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
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
