import { buildClient } from '@datocms/cma-client-browser';
import type {
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { projectAdminUrl, recordEditorPath } from './projectUrl';

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

export type FullEditorResult = {
  opened: boolean;
  url: string;
};

type FullEditorCtx = {
  site: { attributes: { internal_domain: string | null | undefined } };
  environment: string;
  isEnvironmentPrimary: boolean;
  currentUserAccessToken: string | null | undefined;
  cmaBaseUrl: string;
};

export type AgentNavigator = {
  readonly supportsRecordList: boolean;
  openRecord(target: RecordTarget): Promise<void>;
  showRecords(target: RecordListTarget): Promise<void>;
  openAsset(target: AssetTarget): Promise<OpenAssetResult>;
  openRecordInFullEditor(target: RecordTarget): Promise<FullEditorResult>;
};

async function resolveRecordItemTypeId(
  ctx: FullEditorCtx,
  itemId: string,
): Promise<string> {
  if (!ctx.currentUserAccessToken) {
    throw new Error(
      'Sign in to DatoCMS before opening a record in the full editor.',
    );
  }

  const item = await buildClient({
    apiToken: ctx.currentUserAccessToken,
    environment: ctx.environment,
    baseUrl: ctx.cmaBaseUrl,
  }).items.find(itemId);
  const itemTypeId = item.item_type.id;
  if (!itemTypeId) {
    throw new Error('The record model could not be determined.');
  }

  return itemTypeId;
}

async function openRecordEditorTab(
  ctx: FullEditorCtx,
  target: RecordTarget,
): Promise<FullEditorResult> {
  const itemId = target.itemId.trim();
  if (!itemId) {
    throw new Error('A record ID is required to open the full editor.');
  }

  // Open the tab during the click, before any record lookup, so the browser
  // still treats it as a user action.
  const popup = window.open('about:blank', '_blank');
  if (popup) {
    popup.opener = null;
  }

  try {
    const itemTypeId =
      target.itemTypeId?.trim() || (await resolveRecordItemTypeId(ctx, itemId));
    const url = projectAdminUrl(
      {
        internalDomain: ctx.site.attributes.internal_domain,
        environment: ctx.environment,
        isEnvironmentPrimary: ctx.isEnvironmentPrimary,
      },
      recordEditorPath(itemTypeId, itemId),
    );
    if (!url) {
      throw new Error(
        'This project has no admin domain, so the full editor cannot be opened.',
      );
    }
    if (!popup) {
      return { opened: false, url };
    }

    popup.location.replace(url);
    return { opened: true, url };
  } catch (error) {
    popup?.close();
    throw error;
  }
}

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
    openRecordInFullEditor(target) {
      return openRecordEditorTab(ctx, target);
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
    openRecordInFullEditor(target) {
      return openRecordEditorTab(ctx, target);
    },
  };
}
