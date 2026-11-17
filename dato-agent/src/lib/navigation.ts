import type {
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';

export type RecordTarget = {
  itemId: string;
  itemTypeId?: string | null;
  fieldPath?: string | null;
  label?: string | null;
};

export type RecordListTarget = {
  title: string;
  records: RecordTarget[];
};

export type AssetTarget = {
  uploadId: string;
  label?: string | null;
};

export type OpenAssetResult = {
  deleted: boolean;
  uploadId?: string;
  title?: string;
};

export type AgentNavigator = {
  readonly supportsRecordList: boolean;
  openRecord(target: RecordTarget): Promise<void>;
  showRecords(target: RecordListTarget): Promise<void>;
  openAsset(target: AssetTarget): Promise<OpenAssetResult>;
};

/** How many records the inspector's fallback list keeps. */
const MAX_LISTED_RECORDS = 50;

/**
 * Navigates the Agent tab's right pane. Keep one per tab: it owns the record
 * list. `getCtx` returns the latest ctx, since the host replaces it on update.
 */
export function createInspectorNavigator(
  getCtx: () => RenderInspectorCtx,
): AgentNavigator {
  // The record editor's back arrow switches the right pane to the record list,
  // and the CMS shows an empty list as an endless spinner. So the list always
  // holds the records the chat showed or opened, and Back lands somewhere real.
  let list = { title: 'Records opened from the chat', itemIds: [] as string[] };

  return {
    supportsRecordList: true,
    async openRecord(target) {
      if (!list.itemIds.includes(target.itemId)) {
        // A record added to a shown list no longer fits that list's title.
        list = {
          title: 'Records opened from the chat',
          itemIds: [target.itemId, ...list.itemIds].slice(
            0,
            MAX_LISTED_RECORDS,
          ),
        };
      }
      // Sent on every open: the host can replace the list behind our back.
      await getCtx().setInspectorItemListData(list);
      await getCtx().setInspectorMode({
        type: 'itemEditor',
        itemId: target.itemId,
        ...(target.fieldPath ? { fieldPath: target.fieldPath } : {}),
      });
    },
    async showRecords(target) {
      const itemIds = [
        ...new Set(target.records.map((record) => record.itemId)),
      ];
      list = { title: target.title || 'Records', itemIds };
      await getCtx().setInspectorItemListData(list);
      await getCtx().setInspectorMode({ type: 'itemList' });
    },
    async openAsset(target) {
      const result = await getCtx().editUpload(target.uploadId);
      if (result && !('deleted' in result)) {
        return {
          deleted: false,
          uploadId: result.id,
          title: result.attributes.filename,
        };
      }
      return {
        deleted: Boolean(
          result && 'deleted' in result && result.deleted === true,
        ),
      };
    },
  };
}

export function createSidebarNavigator(
  ctx: RenderItemFormSidebarCtx,
): AgentNavigator {
  return {
    supportsRecordList: false,
    async openRecord(target) {
      if (ctx.item?.id === target.itemId) {
        if (target.fieldPath) {
          const currentModelField = Object.values(ctx.fields ?? {}).find(
            (field) =>
              field?.relationships.item_type.data.id === ctx.itemType.id &&
              field.attributes.api_key === target.fieldPath,
          );

          if (currentModelField?.attributes.localized) {
            await ctx.scrollToField(
              `${target.fieldPath}.${ctx.locale}`,
              ctx.locale,
            );
          } else {
            await ctx.scrollToField(target.fieldPath);
          }
        }
        return;
      }

      await ctx.editItem(target.itemId);
    },
    async showRecords(target) {
      if (target.records.length === 0) {
        return;
      }

      if (target.records.length === 1) {
        await this.openRecord(target.records[0]);
        return;
      }

      // Multiple records remain available as clickable chat receipts. Opening
      // one automatically would be arbitrary, while navigating to a collection
      // would replace the record form and discard the sidebar chat.
    },
    async openAsset(target) {
      const result = await ctx.editUpload(target.uploadId);
      if (result && !('deleted' in result)) {
        return {
          deleted: false,
          uploadId: result.id,
          title: result.attributes.filename,
        };
      }
      return {
        deleted: Boolean(
          result && 'deleted' in result && result.deleted === true,
        ),
      };
    },
  };
}

type EnvironmentCtx = { environment: string; isEnvironmentPrimary: boolean };

/** The CMS path prefix of the current environment: empty for the primary one. */
export function environmentPrefix(ctx: EnvironmentCtx): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

/** This plugin's settings page. Sandbox paths need the environment prefix; the primary has none. */
export function pluginSettingsPath(
  ctx: EnvironmentCtx,
  pluginId: string,
): string {
  return `${environmentPrefix(ctx)}/configuration/plugins/${pluginId}/edit`;
}
