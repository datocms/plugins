import {
  buildClient,
  type Client,
  type SchemaTypes,
} from '@datocms/cma-client-browser';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { ButtonLink, Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
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

type Row = { id: string; label: string };

function resolveLabelFromLocalizedValue(
  value: Record<string, string | null | undefined>,
  locales: string[],
): string | undefined {
  const matchingLocale = locales.find((locale) => value[locale]);
  if (matchingLocale) {
    const localeValue = value[matchingLocale];
    if (typeof localeValue === 'string' && localeValue.trim().length > 0) {
      return localeValue;
    }
  }
  return undefined;
}

function resolveLabelFromTitleField(
  item: { attributes: Record<string, unknown> },
  titleField: SchemaTypes.Field,
  locales: string[],
): string | undefined {
  const value = item.attributes[titleField.attributes.api_key];

  if (titleField.attributes.localized && value && typeof value === 'object') {
    const localized = value as Record<string, string | null | undefined>;
    return resolveLabelFromLocalizedValue(localized, locales);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return undefined;
}

function mapItemToRow(
  item: { id: string; attributes: Record<string, unknown> },
  titleField: SchemaTypes.Field | undefined,
  locales: string[],
): Row {
  const fallbackLabel = `Record#${item.id}`;

  if (!titleField) {
    return { id: item.id, label: fallbackLabel };
  }

  const resolvedLabel = resolveLabelFromTitleField(item, titleField, locales);
  return { id: item.id, label: resolvedLabel ?? fallbackLabel };
}

function findLinkField(
  fields: SchemaTypes.Field[],
  linkItemType: SchemaTypes.ItemType,
  fieldApiKey: string,
): SchemaTypes.Field | undefined {
  return fields.find((field) => {
    const fieldItemTypeId = field.relationships.item_type.data.id;
    return (
      fieldItemTypeId === linkItemType.id &&
      field.attributes.api_key === fieldApiKey
    );
  });
}

function buildFieldFilter(
  linkField: SchemaTypes.Field,
  currentItemId: string,
): Record<string, unknown> {
  if (linkField.attributes.field_type === 'link') {
    return { eq: currentItemId };
  }
  return { any_in: [currentItemId] };
}

type FetchRowsParams = {
  client: Client;
  currentItemId: string;
  itemTypes: SchemaTypes.ItemType[];
  fields: SchemaTypes.Field[];
  ctxFields: RenderItemFormSidebarPanelCtx['fields'];
  locales: string[];
  itemTypeApiKey: string;
  fieldApiKey: string;
  orderBy: string | undefined;
  limit: number | undefined;
};

async function fetchInverseRelationshipRows({
  client,
  currentItemId,
  itemTypes,
  fields,
  ctxFields,
  locales,
  itemTypeApiKey,
  fieldApiKey,
  orderBy,
  limit,
}: FetchRowsParams): Promise<Row[]> {
  const linkItemType = itemTypes.find(
    (itemType) => itemType.attributes.api_key === itemTypeApiKey,
  );

  if (!linkItemType) {
    throw new Error('Configured model was not found.');
  }

  const linkField = findLinkField(fields, linkItemType, fieldApiKey);

  if (!linkField) {
    throw new Error('Configured field was not found in the configured model.');
  }

  const fieldFilter = buildFieldFilter(linkField, currentItemId);

  const response = await client.items.rawList({
    version: 'current',
    filter: {
      type: linkItemType.id,
      fields: {
        [fieldApiKey]: fieldFilter,
      },
    },
    order_by: orderBy || '_updated_at_DESC',
    page: {
      limit: Number(limit || 10),
    },
  });

  const titleFieldId = linkItemType.relationships.title_field.data?.id;
  const titleField = titleFieldId ? ctxFields[titleFieldId] : undefined;

  return response.data.map((item) => mapItemToRow(item, titleField, locales));
}

export default function SidebarPanel({ ctx }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

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
        setError(
          'Please configure a valid model and field in plugin settings.',
        );
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

        const mapped = await fetchInverseRelationshipRows({
          client,
          currentItemId: ctx.item.id,
          itemTypes,
          fields,
          ctxFields: ctx.fields,
          locales: ctx.site.attributes.locales,
          itemTypeApiKey: params.itemTypeApiKey,
          fieldApiKey: params.fieldApiKey,
          orderBy: params.orderBy,
          limit: params.limit,
        });

        setRows(mapped);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Failed to load inverse relationships.',
        );
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [
    client,
    ctx.fields,
    ctx.item?.id,
    ctx.itemTypes,
    ctx.site.attributes.locales,
    params.fieldApiKey,
    params.itemTypeApiKey,
    params.limit,
    params.orderBy,
  ]);

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
                    ctx.navigateTo(
                      `/editor/item_types/${model.id}/items/${row.id}/edit`,
                    );
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
