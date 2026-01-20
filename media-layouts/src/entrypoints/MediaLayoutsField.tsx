import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback } from 'react';
import type {
  MediaLayoutItem,
  MultipleFieldValue,
  FieldParams,
  SlotAssignment,
  LayoutFieldValue,
} from '../types';
import {
  normalizeFieldParams,
  normalizeGlobalParams,
  getEffectiveDefaults,
} from '../utils/fieldParams';
import { calculateOutputHeight } from '../utils/aspectRatio';
import SingleAssetEditor from '../components/SingleAssetEditor';
import GalleryEditor from '../components/GalleryEditor';
import SlotEditor from '../components/SlotEditor';
import EmptyState from '../components/EmptyState';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

function getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/[.[\]]+/).filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export default function MediaLayoutsField({ ctx }: Props) {
  const fieldParams = normalizeFieldParams(ctx.parameters as FieldParams);
  const globalParams = normalizeGlobalParams(ctx.plugin.attributes.parameters);
  const defaults = getEffectiveDefaults(fieldParams, globalParams);

  const isMultiple = fieldParams.mode === 'multiple';
  const isLayout = fieldParams.mode === 'layout';
  const rawValue = getValueAtPath(ctx.formValues, ctx.fieldPath);

  // JSON fields store stringified JSON, so we need to parse it
  const currentValue = (() => {
    if (!rawValue) {
      if (isLayout || isMultiple) return [];
      return null;
    }
    if (typeof rawValue === 'string') {
      try {
        return JSON.parse(rawValue) as
          | MediaLayoutItem
          | MultipleFieldValue
          | LayoutFieldValue;
      } catch {
        if (isLayout || isMultiple) return [];
        return null;
      }
    }
    // Already an object (shouldn't happen but handle gracefully)
    return rawValue as MediaLayoutItem | MultipleFieldValue | LayoutFieldValue;
  })();

  // Helper to create a new MediaLayoutItem from an upload
  const createMediaLayoutItem = useCallback(
    (upload: {
      id: string;
      attributes: Record<string, unknown>;
    }): MediaLayoutItem => {
      const attrs = upload.attributes;
      const metadata = (
        attrs.default_field_metadata as Record<
          string,
          {
            alt?: string | null;
            title?: string | null;
            focal_point?: { x: number; y: number } | null;
          }
        >
      )?.[ctx.locale];

      const originalWidth = (attrs.width as number) ?? null;
      const originalHeight = (attrs.height as number) ?? null;

      const height = calculateOutputHeight(
        defaults.width,
        defaults.aspectRatio,
        undefined,
        originalWidth,
        originalHeight
      );

      return {
        uploadId: upload.id,
        url: attrs.url as string,
        filename: attrs.filename as string,
        format: (attrs.format as string) ?? null,
        size: attrs.size as number,
        alt: metadata?.alt ?? null,
        title: metadata?.title ?? null,
        focalPoint: metadata?.focal_point ?? null,
        aspectRatio: defaults.aspectRatio,
        width: defaults.width,
        height,
        originalWidth,
        originalHeight,
      };
    },
    [ctx.locale, defaults]
  );

  const handleSelectAssetForMultiple = useCallback(async () => {
    const result = await ctx.selectUpload({ multiple: true });

    if (!result) return;

    const newItems: MediaLayoutItem[] = result.map((upload) =>
      createMediaLayoutItem(upload)
    );

    const existingItems = Array.isArray(currentValue) ? currentValue : [];
    const newValue = [...existingItems, ...newItems];
    ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newValue));
  }, [ctx, currentValue, createMediaLayoutItem]);

  const handleSelectAssetForSingle = useCallback(async () => {
    const result = await ctx.selectUpload({ multiple: false });

    if (!result) return;

    const newItem = createMediaLayoutItem(result);
    ctx.setFieldValue(ctx.fieldPath, JSON.stringify(newItem));
  }, [ctx, createMediaLayoutItem]);

  const handleSelectAsset = isMultiple
    ? handleSelectAssetForMultiple
    : handleSelectAssetForSingle;

  const handleClear = useCallback(() => {
    ctx.setFieldValue(ctx.fieldPath, isMultiple ? '[]' : null);
  }, [ctx, isMultiple]);

  const handleLayoutAssignmentsChange = useCallback(
    (assignments: SlotAssignment[]) => {
      ctx.setFieldValue(ctx.fieldPath, JSON.stringify(assignments));
    },
    [ctx]
  );

  // Handle layout mode
  if (isLayout) {
    const layoutConfig = fieldParams.layoutConfig;
    const assignments = Array.isArray(currentValue)
      ? (currentValue as LayoutFieldValue)
      : [];

    return (
      <Canvas ctx={ctx}>
        <div className={s.mediaLayoutsField}>
          <SlotEditor
            ctx={ctx}
            layoutConfig={layoutConfig}
            assignments={assignments}
            onAssignmentsChange={handleLayoutAssignmentsChange}
          />
        </div>
      </Canvas>
    );
  }

  const hasAssets = isMultiple
    ? Array.isArray(currentValue) && currentValue.length > 0
    : currentValue !== null;

  return (
    <Canvas ctx={ctx}>
      <div className={s.mediaLayoutsField}>
        {!hasAssets ? (
          <EmptyState
            isGallery={isMultiple}
            onSelectAsset={handleSelectAsset}
            disabled={ctx.disabled}
          />
        ) : isMultiple ? (
          <GalleryEditor
            ctx={ctx}
            items={currentValue as MultipleFieldValue}
            onAddAsset={handleSelectAsset}
          />
        ) : (
          <SingleAssetEditor
            ctx={ctx}
            item={currentValue as MediaLayoutItem}
            onSelectAsset={handleSelectAsset}
            onClear={handleClear}
          />
        )}
      </div>
    </Canvas>
  );
}
