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

export function createInspectorNavigator(
  ctx: RenderInspectorCtx,
): AgentNavigator {
  return {
    supportsRecordList: true,
    async openRecord(target) {
      await ctx.setInspectorMode({
        type: 'itemEditor',
        itemId: target.itemId,
        ...(target.fieldPath ? { fieldPath: target.fieldPath } : {}),
      });
    },
    async showRecords(target) {
      const itemIds = [
        ...new Set(target.records.map((record) => record.itemId)),
      ];

      await ctx.setInspectorItemListData({
        title: target.title || 'Records',
        itemIds,
      });
      await ctx.setInspectorMode({ type: 'itemList' });
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
