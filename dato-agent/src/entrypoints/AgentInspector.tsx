import type { Field, ItemType, RenderInspectorCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useRef } from 'react';
import { openApprovalDetailsModal } from '../lib/approvalDetailsModal';
import { confirmEnableAutoApproval } from '../lib/autoApproval';
import { normalizeConfig } from '../lib/config';
import {
  buildStandaloneHostContext,
  createModelSchemaResolver,
} from '../lib/hostContext';
import { resolveFieldsWithinDeadline } from '../lib/hostContextDeadline';
import { createAgentMentionHost } from '../lib/mentionHost';
import { createInspectorNavigator } from '../lib/navigation';
import AgentFrame from './AgentFrame';

type Props = {
  ctx: RenderInspectorCtx;
};

const MAX_EAGER_PROJECT_MODELS = 40;
const MAX_EAGER_PROJECT_FIELDS = 400;
const PROJECT_FIELD_LOAD_CONCURRENCY = 4;

function presentEntities<T>(repo: Partial<Record<string, T>>): T[] {
  return Object.values(repo).filter((entity): entity is T => Boolean(entity));
}

function itemTypeCatalogSignature(itemTypes: readonly ItemType[]): string {
  return itemTypes
    .map((itemType) =>
      JSON.stringify({
        id: itemType.id,
        apiKey: itemType.attributes.api_key,
        name: itemType.attributes.name,
        block: itemType.attributes.modular_block,
        singleton: itemType.attributes.singleton,
        allLocalesRequired: itemType.attributes.all_locales_required,
        draftMode: itemType.attributes.draft_mode_active,
        draftSaving: itemType.attributes.draft_saving_active,
        sortable: itemType.attributes.sortable,
        tree: itemType.attributes.tree,
        hint: itemType.attributes.hint,
        fields: itemType.relationships.fields.data.map((field) => field.id),
        titleField: itemType.relationships.title_field.data?.id,
        presentationTitleField:
          itemType.relationships.presentation_title_field.data?.id,
        presentationImageField:
          itemType.relationships.presentation_image_field.data?.id,
        imagePreviewField: itemType.relationships.image_preview_field.data?.id,
        excerptField: itemType.relationships.excerpt_field.data?.id,
        orderingField: itemType.relationships.ordering_field.data?.id,
        workflow: itemType.relationships.workflow.data?.id,
      }),
    )
    .sort()
    .join('|');
}

function schemaResolverSignature(
  itemTypes: readonly ItemType[],
  fields: readonly Field[],
): string {
  return [
    itemTypeCatalogSignature(itemTypes),
    ...fields
      .map((field) =>
        JSON.stringify({
          id: field.id,
          apiKey: field.attributes.api_key,
          label: field.attributes.label,
          type: field.attributes.field_type,
          localized: field.attributes.localized,
          hint: field.attributes.hint,
          validators: field.attributes.validators,
          editor: field.attributes.appearance.editor,
          editorParameters: field.attributes.appearance.parameters,
          position: field.attributes.position,
        }),
      )
      .sort(),
  ].join('|');
}

function hasEveryModelField(
  itemType: ItemType,
  fields: readonly Field[],
): boolean {
  const fieldIds = new Set(fields.map((field) => field.id));
  return itemType.relationships.fields.data.every((field) =>
    fieldIds.has(field.id),
  );
}

function shouldLoadProjectFields(itemTypes: readonly ItemType[]): boolean {
  const fieldCount = itemTypes.reduce(
    (total, itemType) => total + itemType.relationships.fields.data.length,
    0,
  );

  return (
    itemTypes.length <= MAX_EAGER_PROJECT_MODELS &&
    fieldCount <= MAX_EAGER_PROJECT_FIELDS
  );
}

async function loadMissingProjectFields(
  itemTypes: readonly ItemType[],
  initialFields: readonly Field[],
  loadItemTypeFields: (itemTypeId: string) => Promise<Field[]>,
): Promise<Field[]> {
  const fieldsById = new Map(initialFields.map((field) => [field.id, field]));
  const missingModels = itemTypes.filter(
    (itemType) => !hasEveryModelField(itemType, initialFields),
  );
  let cursor = 0;

  const worker = async () => {
    while (cursor < missingModels.length) {
      const itemType = missingModels[cursor];
      cursor += 1;
      if (!itemType) {
        continue;
      }

      try {
        // biome-ignore lint/performance/noAwaitInLoops: The bounded worker pool intentionally limits SDK requests.
        const fields = await loadItemTypeFields(itemType.id);
        for (const field of fields) {
          fieldsById.set(field.id, field);
        }
      } catch {
        // A failed model remains explicitly absent, causing the standalone
        // snapshot to fall back to the complete model directory.
      }
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(PROJECT_FIELD_LOAD_CONCURRENCY, missingModels.length),
      },
      () => worker(),
    ),
  );

  return [...fieldsById.values()];
}

export default function AgentInspector({ ctx }: Props) {
  const latestCtxRef = useRef(ctx);
  latestCtxRef.current = ctx;
  const projectFieldsPromiseRef = useRef<
    | {
        key: string;
        promise: Promise<Field[]>;
      }
    | undefined
  >(undefined);
  const itemTypes = presentEntities(ctx.itemTypes);
  const loadedFields = presentEntities(ctx.fields);
  const eagerProjectSchema = shouldLoadProjectFields(itemTypes);
  const schemaResolverKey = [
    ctx.site.id,
    ctx.environment,
    schemaResolverSignature(itemTypes, loadedFields),
  ].join(':');
  const schemaResolverRef = useRef<{
    key: string;
    resolver: ReturnType<typeof createModelSchemaResolver>;
  } | null>(null);
  if (schemaResolverRef.current?.key !== schemaResolverKey) {
    schemaResolverRef.current = {
      key: schemaResolverKey,
      resolver: createModelSchemaResolver({
        itemTypes,
        loadedFields,
        loadItemTypeFields: (itemTypeId) =>
          latestCtxRef.current.loadItemTypeFields(itemTypeId),
      }),
    };
  }
  const schemaResolver = schemaResolverRef.current.resolver;
  const ensureProjectFields = useCallback((): Promise<Field[]> => {
    const live = latestCtxRef.current;
    const liveItemTypes = presentEntities(live.itemTypes);
    const liveFields = presentEntities(live.fields);

    if (!shouldLoadProjectFields(liveItemTypes)) {
      return Promise.resolve(liveFields);
    }

    const key = [
      live.site.id,
      live.environment,
      schemaResolverSignature(liveItemTypes, liveFields),
    ].join(':');
    const existing = projectFieldsPromiseRef.current;
    if (existing?.key === key) {
      return existing.promise;
    }

    const promise = loadMissingProjectFields(
      liveItemTypes,
      liveFields,
      (itemTypeId) => live.loadItemTypeFields(itemTypeId),
    );
    projectFieldsPromiseRef.current = { key, promise };
    void promise.then((fields) => {
      if (
        !liveItemTypes.every((itemType) =>
          hasEveryModelField(itemType, fields),
        ) &&
        projectFieldsPromiseRef.current?.promise === promise
      ) {
        projectFieldsPromiseRef.current = undefined;
      }
    });
    return promise;
  }, []);

  useEffect(() => {
    if (!eagerProjectSchema) {
      return;
    }

    void ensureProjectFields().catch(() => {
      // Submission can still use the complete model directory and Remote MCP.
    });
  }, [eagerProjectSchema, ensureProjectFields]);

  const loadHostContext = useCallback(
    async (signal?: AbortSignal) => {
      const contextAtStart = latestCtxRef.current;
      const fields = await resolveFieldsWithinDeadline({
        fieldsPromise: ensureProjectFields(),
        fallbackFields: presentEntities(contextAtStart.fields),
        signal,
      });
      const live = latestCtxRef.current;
      return buildStandaloneHostContext({
        siteId: live.site.id,
        siteName: live.site.attributes.name,
        environment: live.environment,
        isEnvironmentPrimary: live.isEnvironmentPrimary,
        locales: live.site.attributes.locales,
        uiLocale: live.ui.locale,
        timezone: live.site.attributes.timezone,
        itemTypes: presentEntities(live.itemTypes),
        loadedFields: fields,
        highlightedItemId: live.highlightedItemId,
        location: live.location,
      });
    },
    [ensureProjectFields],
  );
  const frameKey = [
    ctx.plugin.id,
    ctx.site.id,
    ctx.environment,
    ctx.currentUser.id,
    'project',
  ].join(':');
  const mentionHost = createAgentMentionHost(ctx);

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <AgentFrame
        key={frameKey}
        pluginId={ctx.plugin.id}
        siteId={ctx.site.id}
        siteName={ctx.site.attributes.name}
        environment={ctx.environment}
        isEnvironmentPrimary={ctx.isEnvironmentPrimary}
        currentUserId={ctx.currentUser.id}
        surface="project"
        scope={{ type: 'project' }}
        navigator={createInspectorNavigator(ctx)}
        mentionHost={mentionHost}
        config={normalizeConfig(ctx.plugin.attributes.parameters)}
        loadHostContext={loadHostContext}
        getModelSchema={async ({ identifier, cursor }) => ({
          schema: (await schemaResolver(identifier, cursor)).text,
        })}
        onReviewApprovalDetails={(approval) =>
          openApprovalDetailsModal(ctx, approval)
        }
        onConfirmEnableAutoApprove={() =>
          confirmEnableAutoApproval(ctx, {
            siteName: ctx.site.attributes.name,
            environment: ctx.environment,
            isEnvironmentPrimary: ctx.isEnvironmentPrimary,
          })
        }
      />
    </Canvas>
  );
}
