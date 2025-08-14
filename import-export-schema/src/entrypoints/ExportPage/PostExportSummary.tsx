import type { SchemaTypes } from '@datocms/cma-client';
import { Button, TextField } from 'datocms-react-ui';
import { useId, useMemo, useState } from 'react';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { ExportDoc } from '@/utils/types';
import { ExportSchema } from './ExportSchema';

// Removed combined FieldsAndFieldsetsSummary in favor of separate panels

type Props = {
  exportDoc: ExportDoc;
  adminDomain?: string;
  onClose: () => void;
  onDownload: () => void;
};

export default function PostExportSummary({
  exportDoc,
  adminDomain,
  onClose,
  onDownload,
}: Props) {
  const searchId = useId();
  const exportSchema = useMemo(() => new ExportSchema(exportDoc), [exportDoc]);
  // Derive admin origin from provided domain or referrer as a robust fallback
  const adminOrigin = useMemo(
    () => (adminDomain ? `https://${adminDomain}` : undefined),
    [adminDomain],
  );
  console.log('[PostExportSummary] adminOrigin:', adminOrigin);

  const stats = useMemo(() => {
    const models = exportSchema.itemTypes.filter(
      (it) => !it.attributes.modular_block,
    );
    const blocks = exportSchema.itemTypes.filter(
      (it) => it.attributes.modular_block,
    );
    const fields = exportSchema.fields;
    const fieldsets = exportSchema.fieldsets;
    const plugins = exportSchema.plugins;
    return { models, blocks, fields, fieldsets, plugins };
  }, [exportSchema]);

  const connections = useMemo(
    () => buildConnections(exportSchema),
    [exportSchema],
  );

  const connectionsById = useMemo(() => {
    const map = new Map<
      string,
      {
        linkedItemTypes: Array<{
          target: SchemaTypes.ItemType;
          fields: SchemaTypes.Field[];
        }>;
        linkedPlugins: Array<{
          plugin: SchemaTypes.Plugin;
          fields: SchemaTypes.Field[];
        }>;
      }
    >();
    for (const c of connections) {
      map.set(c.itemType.id, {
        linkedItemTypes: c.linkedItemTypes,
        linkedPlugins: c.linkedPlugins,
      });
    }
    return map;
  }, [connections]);

  const [contentQuery, setContentQuery] = useState('');
  const chipStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '72px',
    height: '18px',
    fontSize: '10px',
    padding: '0 4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as const;

  const allFields = exportSchema.fields;
  const allFieldsets = exportSchema.fieldsets;

  const filteredModels = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return stats.models;
    return stats.models.filter(
      (it) =>
        it.attributes.name.toLowerCase().includes(q) ||
        it.attributes.api_key.toLowerCase().includes(q),
    );
  }, [stats.models, contentQuery]);

  const filteredBlocks = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return stats.blocks;
    return stats.blocks.filter(
      (it) =>
        it.attributes.name.toLowerCase().includes(q) ||
        it.attributes.api_key.toLowerCase().includes(q),
    );
  }, [stats.blocks, contentQuery]);

  const filteredPlugins = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return stats.plugins;
    return stats.plugins.filter((pl) =>
      pl.attributes.name.toLowerCase().includes(q),
    );
  }, [stats.plugins, contentQuery]);

  const filteredFields = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return allFields;
    return allFields.filter((f) => {
      const label = (f.attributes.label || '').toLowerCase();
      const apiKey = f.attributes.api_key.toLowerCase();
      return label.includes(q) || apiKey.includes(q);
    });
  }, [allFields, contentQuery]);

  const filteredFieldsets = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return allFieldsets;
    return allFieldsets.filter((fs) =>
      (fs.attributes.title || '').toLowerCase().includes(q),
    );
  }, [allFieldsets, contentQuery]);

  const fieldsetParentById = useMemo(() => {
    const map = new Map<string, SchemaTypes.ItemType>();
    for (const it of exportSchema.itemTypes) {
      for (const fs of exportSchema.getItemTypeFieldsets(it)) {
        map.set(String(fs.id), it);
      }
    }
    return map;
  }, [exportSchema]);
  type SectionKey = 'models' | 'blocks' | 'plugins' | 'fields' | 'fieldsets';
  const [activeSection, setActiveSection] = useState<SectionKey>('models');
  const sections: Array<{
    key: SectionKey;
    label: string;
    count: number;
  }> = [
    { key: 'models', label: 'Models', count: stats.models.length },
    { key: 'blocks', label: 'Blocks', count: stats.blocks.length },
    { key: 'plugins', label: 'Plugins', count: stats.plugins.length },
    { key: 'fields', label: 'Fields', count: allFields.length },
    { key: 'fieldsets', label: 'Fieldsets', count: allFieldsets.length },
  ];

  return (
    <div className="page" style={{ height: '100%' }}>
      <div
        className="page__content summary"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%',
          overflow: 'auto',
        }}
      >
        <div className="summary__section">
          <div className="summary__layout">
            <div className="summary__nav surface">
              {sections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`summary__nav__item ${activeSection === s.key ? 'is-active' : ''}`}
                  onClick={() => setActiveSection(s.key)}
                  aria-current={activeSection === s.key}
                >
                  <span className="summary__nav__label">{s.label}</span>
                  <span className="chip chip--soft">{s.count}</span>
                </button>
              ))}
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <Button
                  buttonSize="s"
                  onClick={onDownload}
                  style={{ width: '100%' }}
                >
                  Download JSON
                </Button>
                <Button
                  buttonType="primary"
                  buttonSize="s"
                  onClick={onClose}
                  style={{ width: '100%' }}
                >
                  Back to Export
                </Button>
              </div>
            </div>
            <div className="summary__content surface">
              {activeSection === 'models' && (
                <>
                  <div className="summary__content__title">
                    Models ({stats.models.length})
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <TextField
                      id={searchId}
                      name="summary-search"
                      label="Search models"
                      placeholder="Search by name or API key"
                      value={contentQuery}
                      onChange={(val) => setContentQuery(val)}
                      textInputProps={{ autoComplete: 'off' }}
                    />
                  </div>
                  <LimitedList
                    items={filteredModels}
                    renderItem={(it) => (
                      <li
                        key={it.id}
                        className={adminOrigin ? 'list-item--link' : ''}
                      >
                        {adminOrigin ? (
                          <a
                            href={`${adminOrigin}/schema/item_types/${it.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in new tab"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <span>
                              {it.attributes.name}{' '}
                              <span style={{ color: '#666' }}>
                                <code>{it.attributes.api_key}</code>
                              </span>
                            </span>
                            <span
                              style={{
                                display: 'inline-flex',
                                gap: 6,
                                flex: '0 0 auto',
                              }}
                            >
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedItemTypes
                                  .length ?? 0}{' '}
                                links
                              </span>
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedPlugins
                                  .length ?? 0}{' '}
                                plugins
                              </span>
                            </span>
                          </a>
                        ) : (
                          <>
                            {it.attributes.name}{' '}
                            <span style={{ color: '#666' }}>
                              <code>{it.attributes.api_key}</code>
                            </span>
                            <span
                              style={{
                                display: 'inline-flex',
                                gap: 6,
                                flex: '0 0 auto',
                              }}
                            >
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedItemTypes
                                  .length ?? 0}{' '}
                                links
                              </span>
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedPlugins
                                  .length ?? 0}{' '}
                                plugins
                              </span>
                            </span>
                          </>
                        )}
                      </li>
                    )}
                  />
                </>
              )}
              {activeSection === 'blocks' && (
                <>
                  <div className="summary__content__title">
                    Blocks ({stats.blocks.length})
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <TextField
                      id={searchId}
                      name="summary-search"
                      label="Search blocks"
                      placeholder="Search by name or API key"
                      value={contentQuery}
                      onChange={(val) => setContentQuery(val)}
                      textInputProps={{ autoComplete: 'off' }}
                    />
                  </div>
                  <LimitedList
                    items={filteredBlocks}
                    renderItem={(it) => (
                      <li
                        key={it.id}
                        className={adminOrigin ? 'list-item--link' : ''}
                      >
                        {adminOrigin ? (
                          <a
                            href={`${adminOrigin}/schema/blocks_library/${it.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in new tab"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                            }}
                          >
                            <span>
                              {it.attributes.name}{' '}
                              <span style={{ color: '#666' }}>
                                <code>{it.attributes.api_key}</code>
                              </span>
                            </span>
                            <span
                              style={{
                                display: 'inline-flex',
                                gap: 6,
                                flex: '0 0 auto',
                              }}
                            >
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedItemTypes
                                  .length ?? 0}{' '}
                                links
                              </span>
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedPlugins
                                  .length ?? 0}{' '}
                                plugins
                              </span>
                            </span>
                          </a>
                        ) : (
                          <>
                            {it.attributes.name}{' '}
                            <span style={{ color: '#666' }}>
                              <code>{it.attributes.api_key}</code>
                            </span>
                            <span
                              style={{
                                display: 'inline-flex',
                                gap: 6,
                                flex: '0 0 auto',
                              }}
                            >
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedItemTypes
                                  .length ?? 0}{' '}
                                links
                              </span>
                              <span
                                className="chip chip--soft"
                                style={chipStyle}
                              >
                                {connectionsById.get(it.id)?.linkedPlugins
                                  .length ?? 0}{' '}
                                plugins
                              </span>
                            </span>
                          </>
                        )}
                      </li>
                    )}
                  />
                </>
              )}
              {activeSection === 'plugins' && (
                <>
                  <div className="summary__content__title">
                    Plugins ({stats.plugins.length})
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <TextField
                      id={searchId}
                      name="summary-search"
                      label="Search plugins"
                      placeholder="Search by name"
                      value={contentQuery}
                      onChange={(val) => setContentQuery(val)}
                      textInputProps={{ autoComplete: 'off' }}
                    />
                  </div>
                  <ul className="list--plain" style={{ margin: 0 }}>
                    {filteredPlugins.length > 0 ? (
                      filteredPlugins.map((pl) => (
                        <li
                          key={pl.id}
                          className={adminOrigin ? 'list-item--link' : ''}
                        >
                          {adminOrigin ? (
                            <a
                              href={`${adminOrigin}/configuration/plugins/${pl.id}/edit`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in new tab"
                            >
                              {pl.attributes.name}
                            </a>
                          ) : (
                            pl.attributes.name
                          )}
                        </li>
                      ))
                    ) : (
                      <li style={{ color: '#666' }}>No plugins</li>
                    )}
                  </ul>
                </>
              )}
              {activeSection === 'fields' && (
                <>
                  <div className="summary__content__title">
                    Fields ({allFields.length})
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <TextField
                      id={searchId}
                      name="summary-search"
                      label="Search fields"
                      placeholder="Search by label or API key"
                      value={contentQuery}
                      onChange={(val) => setContentQuery(val)}
                      textInputProps={{ autoComplete: 'off' }}
                    />
                  </div>
                  <LimitedList
                    items={filteredFields}
                    renderItem={(f) => {
                      const label = f.attributes.label || f.attributes.api_key;
                      const parentId = String(
                        (f as SchemaTypes.Field).relationships.item_type.data
                          .id,
                      );
                      const parent = exportSchema.itemTypesById.get(parentId);
                      const isBlockParent =
                        parent?.attributes.modular_block === true;
                      const basePath = isBlockParent
                        ? '/schema/blocks_library'
                        : '/schema/item_types';
                      const fieldUrl = `${adminOrigin}${basePath}/${parentId}#f${f.id}`;
                      return (
                        <li
                          key={f.id}
                          className={adminOrigin ? 'list-item--link' : ''}
                        >
                          {adminOrigin ? (
                            <a
                              href={fieldUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in new tab"
                              style={{
                                display: 'inline-block',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {label}{' '}
                              <span style={{ color: '#666' }}>
                                (<code>{f.attributes.api_key}</code>)
                              </span>
                            </a>
                          ) : (
                            <span
                              style={{
                                flex: '1 1 auto',
                                minWidth: 0,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: 'inline-block',
                                maxWidth: '100%',
                              }}
                            >
                              {label}{' '}
                              <span style={{ color: '#666' }}>
                                (<code>{f.attributes.api_key}</code>)
                              </span>
                            </span>
                          )}
                        </li>
                      );
                    }}
                  />
                </>
              )}
              {activeSection === 'fieldsets' && (
                <>
                  <div className="summary__content__title">
                    Fieldsets ({allFieldsets.length})
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <TextField
                      id={searchId}
                      name="summary-search"
                      label="Search fieldsets"
                      placeholder="Search by title"
                      value={contentQuery}
                      onChange={(val) => setContentQuery(val)}
                      textInputProps={{ autoComplete: 'off' }}
                    />
                  </div>
                  <LimitedList
                    items={filteredFieldsets}
                    renderItem={(fs) => {
                      const parent = fieldsetParentById.get(String(fs.id));
                      const isBlockParent =
                        parent?.attributes.modular_block === true;
                      const basePath = isBlockParent
                        ? '/schema/blocks_library'
                        : '/schema/item_types';
                      const href =
                        parent && adminOrigin
                          ? `${adminOrigin}${basePath}/${parent.id}`
                          : undefined;
                      return (
                        <li
                          key={fs.id}
                          className={href ? 'list-item--link' : ''}
                        >
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in new tab"
                              style={{
                                display: 'inline-block',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fs.attributes.title}
                            </a>
                          ) : (
                            <span
                              style={{
                                flex: '1 1 auto',
                                minWidth: 0,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: 'inline-block',
                                maxWidth: '100%',
                              }}
                            >
                              {fs.attributes.title}
                            </span>
                          )}
                        </li>
                      );
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>
        {/* Removed the old connections section; counts are now shown inline in Models/Blocks */}
      </div>
    </div>
  );
}

// Removed SectionTitle in favor of summary__title for cleaner layout

function buildConnections(exportSchema: ExportSchema) {
  const pluginIds = new Set(Array.from(exportSchema.pluginsById.keys()));
  const out = [] as Array<{
    itemType: SchemaTypes.ItemType;
    linkedItemTypes: Array<{
      target: SchemaTypes.ItemType;
      fields: SchemaTypes.Field[];
    }>;
    linkedPlugins: Array<{
      plugin: SchemaTypes.Plugin;
      fields: SchemaTypes.Field[];
    }>;
  }>;

  for (const it of exportSchema.itemTypes) {
    const fields = exportSchema.getItemTypeFields(it);
    const byItemType = new Map<string, SchemaTypes.Field[]>();
    const byPlugin = new Map<string, SchemaTypes.Field[]>();

    for (const field of fields) {
      for (const linkedId of findLinkedItemTypeIds(field)) {
        const arr = byItemType.get(String(linkedId)) || [];
        arr.push(field);
        byItemType.set(String(linkedId), arr);
      }
      for (const pluginId of findLinkedPluginIds(field, pluginIds)) {
        const arr = byPlugin.get(String(pluginId)) || [];
        arr.push(field);
        byPlugin.set(String(pluginId), arr);
      }
    }

    const linkedItemTypes = Array.from(byItemType.entries()).flatMap(
      ([targetId, fields]) => {
        const target = exportSchema.itemTypesById.get(String(targetId));
        return target ? [{ target, fields }] : [];
      },
    );

    const linkedPlugins = Array.from(byPlugin.entries()).flatMap(
      ([pid, fields]) => {
        const plugin = exportSchema.pluginsById.get(String(pid));
        return plugin ? [{ plugin, fields }] : [];
      },
    );

    out.push({ itemType: it, linkedItemTypes, linkedPlugins });
  }

  return out;
}

// Collapsible removed in favor of the new two-pane layout

function LimitedList<T>({
  items,
  renderItem,
  initial = 20,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  initial?: number;
}) {
  const [limit, setLimit] = useState(initial);
  const showingAll = limit >= items.length;
  const visible = items.slice(0, limit);
  return (
    <>
      <ul className="list--plain" style={{ margin: 0 }}>
        {visible.map((it) => renderItem(it))}
      </ul>
      {items.length > initial && (
        <div style={{ marginTop: 8 }}>
          <Button
            buttonSize="s"
            onClick={() => setLimit(showingAll ? initial : items.length)}
          >
            {showingAll ? `Show first ${initial}` : `Show all ${items.length}`}
          </Button>
        </div>
      )}
    </>
  );
}
