import type {
  Field,
  ItemType,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FieldReferenceInput,
  PresentFieldsInput,
  ReadCurrentRecordLiveFormStateInput,
} from '../lib/agentRuntime';
import { openApprovalDetailsModal } from '../lib/approvalDetailsModal';
import { confirmEnableAutoApproval } from '../lib/autoApproval';
import { normalizeConfig } from '../lib/config';
import { migrateConversationScopeInBrowser } from '../lib/conversationScopeMigration';
import type { ConversationScope } from '../lib/conversations';
import {
  buildRecordHostContext,
  createModelSchemaResolver,
  readCurrentRecordFormState,
} from '../lib/hostContext';
import { resolveFieldsWithinDeadline } from '../lib/hostContextDeadline';
import { createAgentMentionHost } from '../lib/mentionHost';
import { createSidebarNavigator } from '../lib/navigation';
import { usePersistedSidebarWidth } from '../lib/persistedWidth';
import AgentFrame, { type AgentFrameProps } from './AgentFrame';

type Props = {
  ctx: RenderItemFormSidebarCtx;
};

type NewRecordScope = { type: 'custom'; id: string };

let fallbackMountedFormNonce = 0;

function createMountedFormNonce(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto?.getRandomValues === 'function') {
    return Array.from(crypto.getRandomValues(new Uint32Array(4)))
      .map((value) => value.toString(36))
      .join('-');
  }

  fallbackMountedFormNonce += 1;
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    fallbackMountedFormNonce.toString(36),
  ].join('-');
}

function ScopeMigratingAgentFrame({
  migrationSourceScope,
  onMigrationAttempted,
  ...props
}: AgentFrameProps & {
  migrationSourceScope?: NewRecordScope;
  onMigrationAttempted: (scope: NewRecordScope, succeeded: boolean) => void;
}) {
  const [effectiveScope, setEffectiveScope] = useState<
    ConversationScope | undefined
  >(() => (migrationSourceScope ? undefined : props.scope));

  useEffect(() => {
    if (!migrationSourceScope) {
      setEffectiveScope(props.scope);
      return;
    }

    const identity = {
      pluginId: props.pluginId,
      siteId: props.siteId,
      environment: props.environment,
      currentUserId: props.currentUserId,
    };
    const result = migrateConversationScopeInBrowser(
      { ...identity, scope: migrationSourceScope },
      { ...identity, scope: props.scope },
    );
    setEffectiveScope(result === 'failed' ? migrationSourceScope : props.scope);
    onMigrationAttempted(migrationSourceScope, result !== 'failed');
  }, [
    migrationSourceScope,
    onMigrationAttempted,
    props.currentUserId,
    props.environment,
    props.pluginId,
    props.scope,
    props.siteId,
  ]);

  return effectiveScope ? (
    <AgentFrame {...props} scope={effectiveScope} />
  ) : null;
}

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

function itemFormIdentity(
  ctx: RenderItemFormSidebarCtx,
  mountedFormNonce: string,
): string {
  return [
    ctx.site.id,
    ctx.environment,
    ctx.itemType.id,
    ctx.item?.id ?? `new:${mountedFormNonce}`,
  ].join(':');
}

function verifyCurrentFieldReference({
  reference,
  fieldsByApiKey,
  locales,
  activeLocale,
  seen,
}: {
  reference: FieldReferenceInput;
  fieldsByApiKey: ReadonlyMap<string, Field>;
  locales: ReadonlySet<string>;
  activeLocale: string;
  seen: Set<string>;
}): FieldReferenceInput {
  const currentField = fieldsByApiKey.get(reference.fieldPath);
  if (!currentField) {
    throw new Error(
      `Field ${JSON.stringify(reference.fieldPath)} no longer exists on the current record.`,
    );
  }

  const locale = currentField.attributes.localized
    ? (reference.locale ?? activeLocale)
    : undefined;
  if (locale && !locales.has(locale)) {
    throw new Error(
      `Locale ${JSON.stringify(locale)} is no longer available on this project.`,
    );
  }

  const key = `${reference.fieldPath}\u0000${locale ?? ''}`;
  if (seen.has(key)) {
    throw new Error(
      `Field ${JSON.stringify(reference.fieldPath)} was referenced more than once.`,
    );
  }
  seen.add(key);

  return {
    fieldPath: reference.fieldPath,
    label: currentField.attributes.label,
    apiKey: currentField.attributes.api_key,
    localized: currentField.attributes.localized,
    fieldType:
      currentField.attributes.appearance.editor ||
      currentField.attributes.field_type,
    ...(locale ? { locale } : {}),
  };
}

export default function AgentSidebar({ ctx }: Props) {
  usePersistedSidebarWidth(ctx.site.id);
  const mountedFormNonceRef = useRef<string | undefined>(undefined);
  if (!mountedFormNonceRef.current) {
    mountedFormNonceRef.current = createMountedFormNonce();
  }
  const mountedFormNonce = mountedFormNonceRef.current;
  const newRecordScope: NewRecordScope = {
    type: 'custom',
    id: `new:${ctx.itemType.id}:${mountedFormNonce}`,
  };
  const latestCtxRef = useRef(ctx);
  latestCtxRef.current = ctx;
  const pendingNewRecordScopeRef = useRef<NewRecordScope | undefined>(
    ctx.item ? undefined : newRecordScope,
  );
  if (!ctx.item) {
    pendingNewRecordScopeRef.current = newRecordScope;
  }
  const onMigrationAttempted = useCallback(
    (scope: NewRecordScope, succeeded: boolean) => {
      if (succeeded && pendingNewRecordScopeRef.current?.id === scope.id) {
        pendingNewRecordScopeRef.current = undefined;
      }
    },
    [],
  );
  const itemTypes = presentEntities(ctx.itemTypes);
  const loadedFields = presentEntities(ctx.fields);
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
  const loadVerifiedCurrentModelFields = useCallback(
    async (signal?: AbortSignal) => {
      const before = latestCtxRef.current;
      const identity = itemFormIdentity(before, mountedFormNonce);
      let loadedModelFields: readonly Field[] = [];
      let availableFields = presentEntities(before.fields);

      if (!hasEveryModelField(before.itemType, availableFields)) {
        loadedModelFields = await resolveFieldsWithinDeadline({
          fieldsPromise: before.loadItemTypeFields(before.itemType.id),
          fallbackFields: [],
          signal,
        });
      }

      if (signal?.aborted) {
        throw new DOMException(
          'The current form read was cancelled.',
          'AbortError',
        );
      }

      const live = latestCtxRef.current;
      if (itemFormIdentity(live, mountedFormNonce) !== identity) {
        throw new Error(
          'The current record changed while its fields were loading. Try again.',
        );
      }

      availableFields = presentEntities(live.fields);
      const fieldsById = new Map(
        availableFields.map((field) => [field.id, field]),
      );
      for (const field of loadedModelFields) {
        fieldsById.set(field.id, field);
      }
      availableFields = [...fieldsById.values()];

      if (!hasEveryModelField(live.itemType, availableFields)) {
        throw new Error(
          'The current model fields could not be verified yet. Try again.',
        );
      }

      return { live, fields: availableFields };
    },
    [mountedFormNonce],
  );

  const prepareCurrentFieldReferences = useCallback(
    async (input: PresentFieldsInput, signal?: AbortSignal) => {
      const { live, fields } = await loadVerifiedCurrentModelFields(signal);
      const currentFields = fields.filter(
        (field) => field.relationships.item_type.data.id === live.itemType.id,
      );
      const fieldsByApiKey = new Map(
        currentFields.map((field) => [field.attributes.api_key, field]),
      );
      const locales = new Set(live.site.attributes.locales);
      const seen = new Set<string>();

      const verified = input.fields.map((reference) =>
        verifyCurrentFieldReference({
          reference,
          fieldsByApiKey,
          locales,
          activeLocale: live.locale,
          seen,
        }),
      );

      return { title: input.title, fields: verified };
    },
    [loadVerifiedCurrentModelFields],
  );

  const openCurrentField = useCallback(
    async (reference: FieldReferenceInput) => {
      const verified = await prepareCurrentFieldReferences({
        title: 'Field',
        fields: [reference],
      });
      const field = verified.fields[0];
      if (!field) {
        throw new Error('This field is no longer available.');
      }

      const formFieldPath = field.locale
        ? `${field.fieldPath}.${field.locale}`
        : field.fieldPath;
      await latestCtxRef.current.scrollToField(formFieldPath, field.locale);
    },
    [prepareCurrentFieldReferences],
  );

  const readCurrentRecordLiveFormState = useCallback(
    async (
      input: ReadCurrentRecordLiveFormStateInput,
      signal?: AbortSignal,
    ) => {
      const { live, fields } = await loadVerifiedCurrentModelFields(signal);
      return readCurrentRecordFormState({
        model: live.itemType,
        fields,
        formValues: live.formValues,
        activeLocale: live.locale,
        locales: live.site.attributes.locales,
        dirty: live.isFormDirty,
        recordId: live.item?.id,
        requests: input.fields.map((field) => ({
          fieldPath: field.fieldApiKey,
          locale: field.locale,
        })),
      });
    },
    [loadVerifiedCurrentModelFields],
  );

  const loadHostContext = useCallback(async (signal?: AbortSignal) => {
    const live = latestCtxRef.current;
    const liveItemTypes = presentEntities(live.itemTypes);
    let liveFields = presentEntities(live.fields);

    if (!hasEveryModelField(live.itemType, liveFields)) {
      const modelFields = await resolveFieldsWithinDeadline({
        fieldsPromise: live.loadItemTypeFields(live.itemType.id),
        fallbackFields: [],
        signal,
      });
      const byId = new Map(liveFields.map((field) => [field.id, field]));
      for (const field of modelFields) {
        byId.set(field.id, field);
      }
      liveFields = [...byId.values()];
    }

    if (signal?.aborted) {
      throw new DOMException('The context load was cancelled.', 'AbortError');
    }

    return buildRecordHostContext({
      siteId: live.site.id,
      siteName: live.site.attributes.name,
      environment: live.environment,
      isEnvironmentPrimary: live.isEnvironmentPrimary,
      locales: live.site.attributes.locales,
      uiLocale: live.ui.locale,
      timezone: live.site.attributes.timezone,
      model: live.itemType,
      itemTypes: liveItemTypes,
      fields: liveFields,
      formValues: live.formValues,
      activeLocale: live.locale,
      status: live.itemStatus,
      dirty: live.isFormDirty,
      submitting: live.isSubmitting,
      recordId: live.item?.id,
      blockCounts: {
        total: live.blocksAnalysis.usage.total,
        nonLocalized: live.blocksAnalysis.usage.nonLocalized,
        perLocale: live.blocksAnalysis.usage.perLocale,
        maximumPerItem: live.blocksAnalysis.maximumPerItem,
      },
    });
  }, []);

  const currentRecord = ctx.item
    ? {
        id: ctx.item.id,
        modelApiKey: ctx.itemType.attributes.api_key,
        hasUnsavedChanges: ctx.isFormDirty,
        title: ctx.itemType.attributes.name,
      }
    : undefined;
  const scopeId = currentRecord
    ? `record:${currentRecord.id}`
    : newRecordScope.id;
  const scope: ConversationScope = currentRecord
    ? { type: 'record', recordId: currentRecord.id }
    : newRecordScope;
  const frameKey = [
    ctx.plugin.id,
    ctx.site.id,
    ctx.environment,
    ctx.currentUser.id,
    scopeId,
  ].join(':');
  const mentionHost = createAgentMentionHost(ctx, {
    currentModelId: ctx.itemType.id,
  });

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <ScopeMigratingAgentFrame
        key={frameKey}
        pluginId={ctx.plugin.id}
        siteId={ctx.site.id}
        siteName={ctx.site.attributes.name}
        environment={ctx.environment}
        isEnvironmentPrimary={ctx.isEnvironmentPrimary}
        currentUserId={ctx.currentUser.id}
        surface="record"
        currentRecord={currentRecord}
        editorHasUnsavedChanges={ctx.isFormDirty}
        scope={scope}
        migrationSourceScope={
          currentRecord ? pendingNewRecordScopeRef.current : undefined
        }
        onMigrationAttempted={onMigrationAttempted}
        navigator={createSidebarNavigator(ctx)}
        mentionHost={mentionHost}
        config={normalizeConfig(ctx.plugin.attributes.parameters)}
        loadHostContext={loadHostContext}
        prepareCurrentFieldReferences={prepareCurrentFieldReferences}
        readCurrentRecordLiveFormState={readCurrentRecordLiveFormState}
        openCurrentField={openCurrentField}
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
