import type { SchemaTypes } from '@datocms/cma-client';
import { Button, TextField } from 'datocms-react-ui';
import { useId, useMemo, useState } from 'react';
import {
  findLinkedItemTypeIds,
  findLinkedPluginIds,
} from '@/utils/datocms/schema';
import type { ExportSchema } from '../ExportPage/ExportSchema';
import type { ImportDoc } from './buildImportDoc';

type Props = {
  exportSchema: ExportSchema;
  importDoc: ImportDoc;
  adminDomain?: string;
  idByApiKey?: Record<string, string>;
  pluginIdByName?: Record<string, string>;
  fieldIdByExportId?: Record<string, string>;
  onClose: () => void;
};

export default function PostImportSummary({
  exportSchema,
  importDoc,
  adminDomain,
  idByApiKey,
  pluginIdByName,
  fieldIdByExportId,
  onClose,
}: Props) {
  const searchId = useId();
  const createdEntries = importDoc.itemTypes.entitiesToCreate;
  const adminOrigin = useMemo(
    () => (adminDomain ? `https://${adminDomain}` : undefined),
    [adminDomain],
  );
  // Map export item type ID -> final API key after rename (or original if unchanged)
  const finalApiKeyByExportItemTypeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of importDoc.itemTypes.entitiesToCreate) {
      map.set(
        String(e.entity.id),
        e.rename?.apiKey || e.entity.attributes.api_key,
      );
    }
    return map;
  }, [importDoc]);
  const createdItemTypes = useMemo(
    () => createdEntries.map((e) => e.entity),
    [createdEntries],
  );
  const createdPlugins = useMemo(
    () => importDoc.plugins.entitiesToCreate,
    [importDoc],
  );
  // counts computed directly from arrays below
  const reusedItemTypesCount = useMemo(
    () => Object.keys(importDoc.itemTypes.idsToReuse).length,
    [importDoc],
  );
  const reusedPluginsCount = useMemo(
    () => Object.keys(importDoc.plugins.idsToReuse).length,
    [importDoc],
  );

  const createdModels = useMemo(
    () => createdEntries.filter((e) => !e.entity.attributes.modular_block),
    [createdEntries],
  );
  const createdBlocks = useMemo(
    () => createdEntries.filter((e) => e.entity.attributes.modular_block),
    [createdEntries],
  );

  const pluginStateById = useMemo(() => {
    const map = new Map<string, 'created' | 'reused' | 'skipped'>();
    for (const pl of exportSchema.plugins) {
      const id = String(pl.id);
      if (importDoc.plugins.entitiesToCreate.find((p) => String(p.id) === id)) {
        map.set(id, 'created');
      } else if (id in importDoc.plugins.idsToReuse) {
        map.set(id, 'reused');
      } else {
        map.set(id, 'skipped');
      }
    }
    return map;
  }, [exportSchema, importDoc]);

  const createdItemTypeIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of createdEntries) set.add(String(e.entity.id));
    return set;
  }, [createdEntries]);

  const connections = useMemo(
    () =>
      buildConnections(
        exportSchema,
        createdItemTypes,
        pluginStateById,
        createdItemTypeIdSet,
      ),
    [exportSchema, createdItemTypes, pluginStateById, createdItemTypeIdSet],
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

  const renamedItems = useMemo(
    () =>
      importDoc.itemTypes.entitiesToCreate.filter(
        (e): e is typeof e & { rename: { name: string; apiKey: string } } =>
          Boolean(e.rename),
      ),
    [importDoc],
  );

  const createdFields = useMemo(
    () => importDoc.itemTypes.entitiesToCreate.flatMap((e) => e.fields),
    [importDoc],
  );
  const createdFieldsets = useMemo(
    () => importDoc.itemTypes.entitiesToCreate.flatMap((e) => e.fieldsets),
    [importDoc],
  );

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

  const filteredModels = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return createdModels;
    return createdModels.filter((e) => {
      const name = (e.rename?.name || e.entity.attributes.name).toLowerCase();
      const apiKey = (
        e.rename?.apiKey || e.entity.attributes.api_key
      ).toLowerCase();
      return name.includes(q) || apiKey.includes(q);
    });
  }, [createdModels, contentQuery]);

  const filteredBlocks = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return createdBlocks;
    return createdBlocks.filter((e) => {
      const name = (e.rename?.name || e.entity.attributes.name).toLowerCase();
      const apiKey = (
        e.rename?.apiKey || e.entity.attributes.api_key
      ).toLowerCase();
      return name.includes(q) || apiKey.includes(q);
    });
  }, [createdBlocks, contentQuery]);

  const filteredPlugins = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return createdPlugins;
    return createdPlugins.filter((pl) =>
      pl.attributes.name.toLowerCase().includes(q),
    );
  }, [createdPlugins, contentQuery]);

  const filteredFields = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return createdFields;
    return createdFields.filter((f) => {
      const label = (f.attributes.label || '').toLowerCase();
      const apiKey = f.attributes.api_key.toLowerCase();
      return label.includes(q) || apiKey.includes(q);
    });
  }, [createdFields, contentQuery]);

  const filteredFieldsets = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return createdFieldsets;
    return createdFieldsets.filter((fs) =>
      (fs.attributes.title || '').toLowerCase().includes(q),
    );
  }, [createdFieldsets, contentQuery]);

  type SectionKey =
    | 'models'
    | 'blocks'
    | 'plugins'
    | 'fields'
    | 'fieldsets'
    | 'reused'
    | 'renames';
  const [activeSection, setActiveSection] = useState<SectionKey>('models');
  const sections: Array<{ key: SectionKey; label: string; count: number }> = [
    { key: 'models', label: 'Models', count: createdModels.length },
    { key: 'blocks', label: 'Blocks', count: createdBlocks.length },
    { key: 'plugins', label: 'Plugins', count: createdPlugins.length },
    { key: 'fields', label: 'Fields', count: createdFields.length },
    { key: 'fieldsets', label: 'Fieldsets', count: createdFieldsets.length },
    {
      key: 'reused',
      label: 'Reused',
      count: reusedItemTypesCount + reusedPluginsCount,
    },
    { key: 'renames', label: 'Renames', count: renamedItems.length },
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
                  buttonType="primary"
                  buttonSize="s"
                  onClick={onClose}
                  style={{ width: '100%' }}
                >
                  Done
                </Button>
              </div>
            </div>
            <div className="summary__content surface">
              {activeSection === 'models' && (
                <>
                  <div className="summary__content__title">
                    Models ({createdModels.length})
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
                    renderItem={(e) => {
                      const name = e.rename?.name || e.entity.attributes.name;
                      const apiKey =
                        e.rename?.apiKey || e.entity.attributes.api_key;
                      const targetId = idByApiKey?.[apiKey];
                      return (
                        <li
                          key={e.entity.id}
                          className={
                            adminOrigin && targetId ? 'list-item--link' : ''
                          }
                        >
                          {adminOrigin && targetId ? (
                            <a
                              href={`${adminOrigin}/schema/item_types/${targetId}`}
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
                                {name}{' '}
                                <span style={{ color: '#666' }}>
                                  <code>{apiKey}</code>
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
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedItemTypes.length ?? 0}{' '}
                                  links
                                </span>
                                <span
                                  className="chip chip--soft"
                                  style={chipStyle}
                                >
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedPlugins.length ?? 0}{' '}
                                  plugins
                                </span>
                              </span>
                            </a>
                          ) : (
                            <>
                              {name}{' '}
                              <span style={{ color: '#666' }}>
                                <code>{apiKey}</code>
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
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedItemTypes.length ?? 0}{' '}
                                  links
                                </span>
                                <span
                                  className="chip chip--soft"
                                  style={chipStyle}
                                >
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedPlugins.length ?? 0}{' '}
                                  plugins
                                </span>
                              </span>
                            </>
                          )}
                        </li>
                      );
                    }}
                  />
                </>
              )}
              {activeSection === 'blocks' && (
                <>
                  <div className="summary__content__title">
                    Blocks ({createdBlocks.length})
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
                    renderItem={(e) => {
                      const name = e.rename?.name || e.entity.attributes.name;
                      const apiKey =
                        e.rename?.apiKey || e.entity.attributes.api_key;
                      const targetId = idByApiKey?.[apiKey];
                      return (
                        <li
                          key={e.entity.id}
                          className={
                            adminOrigin && targetId ? 'list-item--link' : ''
                          }
                        >
                          {adminOrigin && targetId ? (
                            <a
                              href={`${adminOrigin}/schema/blocks_library/${targetId}`}
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
                                {name}{' '}
                                <span style={{ color: '#666' }}>
                                  <code>{apiKey}</code>
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
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedItemTypes.length ?? 0}{' '}
                                  links
                                </span>
                                <span
                                  className="chip chip--soft"
                                  style={chipStyle}
                                >
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedPlugins.length ?? 0}{' '}
                                  plugins
                                </span>
                              </span>
                            </a>
                          ) : (
                            <>
                              {name}{' '}
                              <span style={{ color: '#666' }}>
                                <code>{apiKey}</code>
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
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedItemTypes.length ?? 0}{' '}
                                  links
                                </span>
                                <span
                                  className="chip chip--soft"
                                  style={chipStyle}
                                >
                                  {connectionsById.get(String(e.entity.id))
                                    ?.linkedPlugins.length ?? 0}{' '}
                                  plugins
                                </span>
                              </span>
                            </>
                          )}
                        </li>
                      );
                    }}
                  />
                </>
              )}
              {activeSection === 'plugins' && (
                <>
                  <div className="summary__content__title">
                    Plugins ({createdPlugins.length})
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
                      filteredPlugins.map((pl) => {
                        const name = pl.attributes.name;
                        const pluginId = pluginIdByName?.[name];
                        const href =
                          adminOrigin && pluginId
                            ? `${adminOrigin}/configuration/plugins/${pluginId}/edit`
                            : undefined;
                        return (
                          <li
                            key={pl.id}
                            className={href ? 'list-item--link' : ''}
                          >
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open in new tab"
                              >
                                {name}
                              </a>
                            ) : (
                              name
                            )}
                          </li>
                        );
                      })
                    ) : (
                      <li style={{ color: '#666' }}>No plugins</li>
                    )}
                  </ul>
                </>
              )}
              {activeSection === 'fields' && (
                <>
                  <div className="summary__content__title">
                    Fields ({createdFields.length})
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
                      const finalParentApiKey =
                        finalApiKeyByExportItemTypeId.get(parentId) ||
                        parent?.attributes.api_key;
                      const targetParentId = finalParentApiKey
                        ? idByApiKey?.[finalParentApiKey]
                        : undefined;
                      const newFieldId =
                        fieldIdByExportId?.[String(f.id)] || String(f.id);
                      const href =
                        adminOrigin && targetParentId
                          ? `${adminOrigin}${basePath}/${targetParentId}#f${newFieldId}`
                          : undefined;
                      return (
                        <li
                          key={f.id}
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
                    Fieldsets ({createdFieldsets.length})
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
                      const parent = exportSchema.itemTypes.find((it) =>
                        exportSchema
                          .getItemTypeFieldsets(it)
                          .some((x) => String(x.id) === String(fs.id)),
                      );
                      const isBlockParent =
                        parent?.attributes.modular_block === true;
                      const basePath = isBlockParent
                        ? '/schema/blocks_library'
                        : '/schema/item_types';
                      const finalParentApiKey = parent
                        ? finalApiKeyByExportItemTypeId.get(
                            String(parent.id),
                          ) || parent.attributes.api_key
                        : undefined;
                      const targetParentId = finalParentApiKey
                        ? idByApiKey?.[finalParentApiKey]
                        : undefined;
                      const href =
                        parent && adminOrigin && targetParentId
                          ? `${adminOrigin}${basePath}/${targetParentId}`
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
              {activeSection === 'reused' && (
                <>
                  <div className="summary__content__title">Reused</div>
                  <div className="summary__grid">
                    {reusedItemTypesCount > 0 && (
                      <Box>
                        <div className="box__title">Reused models/blocks</div>
                        <div className="box__meta">
                          {reusedItemTypesCount} reused
                        </div>
                      </Box>
                    )}
                    {reusedPluginsCount > 0 && (
                      <Box>
                        <div className="box__title">Reused plugins</div>
                        <div className="box__meta">
                          {reusedPluginsCount} reused
                        </div>
                      </Box>
                    )}
                  </div>
                </>
              )}
              {activeSection === 'renames' && (
                <>
                  <div className="summary__content__title">Renames</div>
                  <div className="summary__grid">
                    {renamedItems.length > 0 ? (
                      <div className="surface">
                        <div className="box__title">Renamed models/blocks</div>
                        <ul
                          className="list--plain"
                          style={{ margin: 0, marginTop: 8 }}
                        >
                          {renamedItems.map((r) => {
                            const from = exportSchema.getItemTypeById(
                              String(r.entity.id),
                            );
                            const isBlock =
                              from.attributes.modular_block === true;
                            const basePath = isBlock
                              ? '/schema/blocks_library'
                              : '/schema/item_types';
                            const finalApiKey =
                              r.rename?.apiKey || from.attributes.api_key;
                            const targetId = idByApiKey?.[finalApiKey];
                            const href =
                              adminOrigin && targetId
                                ? `${adminOrigin}${basePath}/${targetId}`
                                : undefined;
                            return (
                              <li
                                key={r.entity.id}
                                className={href ? 'list-item--link' : ''}
                              >
                                {href ? (
                                  <a
                                    href={href}
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
                                    <span
                                      style={{
                                        flex: '1 1 auto',
                                        minWidth: 0,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {from.attributes.name}
                                      {' → '}
                                      <strong>{r.rename?.name || ''}</strong>
                                    </span>
                                    <span
                                      style={{
                                        color: '#666',
                                        flex: '0 0 auto',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      (<code>{from.attributes.api_key}</code>
                                      {' → '}
                                      <code>{r.rename?.apiKey || ''}</code>)
                                    </span>
                                  </a>
                                ) : (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 8,
                                    }}
                                  >
                                    <span
                                      style={{
                                        flex: '1 1 auto',
                                        minWidth: 0,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {from.attributes.name}
                                      {' → '}
                                      <strong>{r.rename?.name || ''}</strong>
                                    </span>
                                    <span
                                      style={{
                                        color: '#666',
                                        flex: '0 0 auto',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      (<code>{from.attributes.api_key}</code>
                                      {' → '}
                                      <code>{r.rename?.apiKey || ''}</code>)
                                    </span>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div className="surface">
                        <div className="box__title">Renamed models/blocks</div>
                        <div className="box__meta">0 renamed</div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="surface">{children}</div>;
}

function buildConnections(
  exportSchema: ExportSchema,
  createdItemTypes: SchemaTypes.ItemType[],
  pluginStateById: Map<string, 'created' | 'reused' | 'skipped'>,
  createdItemTypeIdSet: Set<string>,
) {
  const out = [] as Array<{
    itemType: SchemaTypes.ItemType;
    linkedItemTypes: Array<{
      target: SchemaTypes.ItemType;
      fields: SchemaTypes.Field[];
      status: 'created' | 'reused';
    }>;
    linkedPlugins: Array<{
      plugin: SchemaTypes.Plugin;
      fields: SchemaTypes.Field[];
      status: 'created' | 'reused' | 'skipped';
    }>;
  }>;

  for (const it of createdItemTypes) {
    const fields = exportSchema.getItemTypeFields(it);
    const byItemType = new Map<string, SchemaTypes.Field[]>();
    const byPlugin = new Map<string, SchemaTypes.Field[]>();

    for (const field of fields) {
      for (const linkedId of findLinkedItemTypeIds(field)) {
        const arr = byItemType.get(String(linkedId)) || [];
        arr.push(field);
        byItemType.set(String(linkedId), arr);
      }
      for (const pluginId of findLinkedPluginIds(
        field,
        new Set(exportSchema.plugins.map((p) => String(p.id))),
      )) {
        const arr = byPlugin.get(String(pluginId)) || [];
        arr.push(field);
        byPlugin.set(String(pluginId), arr);
      }
    }

    const linkedItemTypes = Array.from(byItemType.entries())
      .map(([targetId, fields]) => {
        const target = exportSchema.itemTypesById.get(String(targetId));
        if (!target) return null; // target not in export doc; skip
        const status: 'created' | 'reused' = createdItemTypeIdSet.has(
          String(targetId),
        )
          ? 'created'
          : 'reused';
        return { target, fields, status };
      })
      .filter(
        (
          v,
        ): v is {
          target: SchemaTypes.ItemType;
          fields: SchemaTypes.Field[];
          status: 'created' | 'reused';
        } => !!v,
      );

    const linkedPlugins = Array.from(byPlugin.entries()).flatMap(
      ([pid, fields]) => {
        const plugin = exportSchema.pluginsById.get(String(pid));
        if (!plugin) return [];
        return [
          {
            plugin,
            fields,
            status: (pluginStateById.get(String(pid)) || 'skipped') as
              | 'created'
              | 'reused'
              | 'skipped',
          },
        ];
      },
    );

    out.push({ itemType: it, linkedItemTypes, linkedPlugins });
  }

  return out;
}

// Collapsible removed in import summary rework

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

// ConnectionsPanel removed; inline counts are shown alongside models/blocks

// StatusPill removed with ConnectionsPanel
