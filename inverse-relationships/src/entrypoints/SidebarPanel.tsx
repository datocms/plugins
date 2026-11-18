import {
  buildClient,
  type Client,
  type SchemaTypes,
} from '@datocms/cma-client-browser';
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import RecordRow from 'datocms-react-ui/RecordRow';
import RowList from 'datocms-react-ui/RowList';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import { useEffect, useMemo, useState } from 'react';
import { CircleExclamationIcon } from '../icons';

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

type Row = Awaited<ReturnType<Client['items']['rawList']>>['data'][number];

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

  return response.data;
}

export default function InverseRelationshipsPanel({ ctx }: Props) {
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>();

  const params = ctx.plugin.attributes.parameters as PluginParameters;

  const client = useMemo(
    () =>
      buildClient({
        apiToken: params.datoCmsApiToken || ctx.currentUserAccessToken || '',
        environment: ctx.environment,
        baseUrl: ctx.cmaBaseUrl,
      }),
    [
      ctx.currentUserAccessToken,
      ctx.environment,
      ctx.cmaBaseUrl,
      params.datoCmsApiToken,
    ],
  );

  useEffect(() => {
    const run = async () => {
      if (!ctx.item?.id) {
        setRows([]);
        return;
      }

      if (!params.itemTypeApiKey || !params.fieldApiKey) {
        setError('No model or field is set.');
        setRows([]);
        return;
      }

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
          itemTypeApiKey: params.itemTypeApiKey,
          fieldApiKey: params.fieldApiKey,
          orderBy: params.orderBy,
          limit: params.limit,
        });

        setError(null);
        setRows(mapped);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Failed to load inverse relationships.',
        );
        setRows([]);
      }
    };

    run();
  }, [
    client,
    ctx.fields,
    ctx.item?.id,
    ctx.itemTypes,
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
      {error ? (
        <BlankSlate
          placement="inline"
          small
          error
          icon={<CircleExclamationIcon />}
          title="The linked records didn't load"
          code={error}
          description="Check the model, field and API token in the plugin settings."
        />
      ) : !rows ? (
        <BlankSlate
          placement="inline"
          small
          loading
          title="Loading the linked records"
        />
      ) : rows.length === 0 ? (
        <SidebarPanel.Blank message="No records link to this record" />
      ) : (
        model && (
          <RecordRow.List showModel={false}>
            <RowList density="compact">
              {rows.map((row) => (
                <RowList.Item
                  key={row.id}
                  to={`${environmentPrefix}/editor/item_types/${model.id}/items/${row.id}/edit`}
                >
                  <RecordRow layout="row" item={row} />
                </RowList.Item>
              ))}
            </RowList>
          </RecordRow.List>
        )
      )}
    </Canvas>
  );
}
