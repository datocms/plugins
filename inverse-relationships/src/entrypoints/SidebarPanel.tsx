import { useEffect, useMemo, useState } from 'react';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas, ButtonLink, Spinner } from 'datocms-react-ui';
import { buildClient, type SchemaTypes } from '@datocms/cma-client-browser';
import s from './styles.module.css';

type PluginParameters = {
  datoCmsApiToken?: string;
  itemTypeApiKey?: string;
  fieldApiKey?: string;
  orderBy?: string;
  limit?: number;
};

type Props = {
  ctx: RenderItemFormSidebarPanelCtx;
};

export default function SidebarPanel({ ctx }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ id: string; label: string }>>([]);

  const params = ctx.plugin.attributes.parameters as PluginParameters;

  const client = useMemo(
    () =>
      buildClient({
        apiToken: params.datoCmsApiToken || ctx.currentUserAccessToken || '',
        environment: ctx.environment,
      }),
    [ctx.currentUserAccessToken, ctx.environment, params.datoCmsApiToken],
  );

  useEffect(() => {
    const run = async () => {
      if (!ctx.item?.id) {
        setRows([]);
        return;
      }

      if (!params.itemTypeApiKey || !params.fieldApiKey) {
        setError('Please configure a valid model and field in plugin settings.');
        setRows([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const itemTypes = Object.values(ctx.itemTypes).filter(
          (itemType): itemType is SchemaTypes.ItemType => Boolean(itemType),
        );
        const fields = Object.values(ctx.fields).filter(
          (field): field is SchemaTypes.Field => Boolean(field),
        );

        const linkItemType = itemTypes.find(
          (itemType) => itemType.attributes.api_key === params.itemTypeApiKey,
        );

        if (!linkItemType) {
          throw new Error('Configured model was not found.');
        }

        const linkField = fields.find((field) => {
          const fieldItemTypeId = field.relationships.item_type.data.id;
          return (
            fieldItemTypeId === linkItemType.id &&
            field.attributes.api_key === params.fieldApiKey
          );
        });

        if (!linkField) {
          throw new Error('Configured field was not found in the configured model.');
        }

        const fieldFilter =
          linkField.attributes.field_type === 'link'
            ? { eq: ctx.item.id }
            : { any_in: [ctx.item.id] };

        const response = await client.items.rawList({
          version: 'current',
          filter: {
            type: linkItemType.id,
            fields: {
              [params.fieldApiKey]: fieldFilter,
            },
          },
          order_by: params.orderBy || '_updated_at_DESC',
          page: {
            limit: Number(params.limit || 10),
          },
        });

        const titleFieldId = linkItemType.relationships.title_field.data?.id;
        const titleField = titleFieldId ? ctx.fields[titleFieldId] : undefined;

        const mapped = response.data.map((item) => {
          let label = `Record#${item.id}`;
          if (titleField) {
            const value = item.attributes[titleField.attributes.api_key] as unknown;
            if (titleField.attributes.localized && value && typeof value === 'object') {
              const localized = value as Record<string, string | null | undefined>;
              const first = ctx.site.attributes.locales.find((locale) => localized[locale]);
              if (first && localized[first]) {
                label = localized[first] as string;
              }
            } else if (typeof value === 'string' && value.trim().length > 0) {
              label = value;
            }
          }

          return {
            id: item.id,
            label,
          };
        });

        setRows(mapped);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load inverse relationships.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [client, ctx.fields, ctx.item?.id, ctx.itemTypes, ctx.site.attributes.locales, params.fieldApiKey, params.itemTypeApiKey, params.limit, params.orderBy]);

  const model = Object.values(ctx.itemTypes)
    .filter((itemType): itemType is SchemaTypes.ItemType => Boolean(itemType))
    .find((itemType) => itemType.attributes.api_key === params.itemTypeApiKey);

  return (
    <Canvas ctx={ctx}>
      <div className={s.root}>
        {loading && (
          <div className={s.center}>
            <Spinner />
          </div>
        )}

        {!loading && error && <p className={s.error}>{error}</p>}

        {!loading && !error && rows.length === 0 && (
          <p className={s.empty}>No linked records found.</p>
        )}

        {!loading && !error && rows.length > 0 && (
          <ul className={s.list}>
            {rows.map((row) => (
              <li key={row.id}>
                <ButtonLink
                  href="#"
                  buttonSize="xxs"
                  buttonType="muted"
                  onClick={() => {
                    if (!model) return;
                    ctx.navigateTo(`/editor/item_types/${model.id}/items/${row.id}/edit`);
                  }}
                >
                  {row.label}
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Canvas>
  );
}
