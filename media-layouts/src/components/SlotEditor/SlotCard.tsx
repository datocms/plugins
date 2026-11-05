import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import EmptySlot from 'datocms-react-ui/EmptySlot';
import EntityRow from 'datocms-react-ui/EntityRow';
import MediaCard from 'datocms-react-ui/MediaCard';
import Pill from 'datocms-react-ui/Pill';
import { useUploadData } from '../../hooks/useUploadData';
import { EditIcon, ReplaceIcon } from '../../icons';
import type {
  LayoutSlot,
  SlotAssignment,
  Upload,
  WidthOption,
} from '../../types';
import { getEffectiveRatio } from '../../utils/aspectRatio';
import { assetTitle, describeSize, slotTitle } from '../../utils/options';
import { assetLoadState, resolveFormat } from '../../utils/upload';
import { AssetOptionFields } from '../AssetFields';
import {
  AssetMedia,
  FailedAsset,
  LoadingAsset,
  useMediaCardMenus,
} from '../AssetMedia';

type Props = {
  ctx: RenderFieldExtensionCtx;
  slot: LayoutSlot;
  assignment: SlotAssignment | undefined;
  widthOptions: WidthOption[];
  enableCssClass: boolean;
  enableLazyLoading: boolean;
  /** The field is read-only: the inputs are disabled and the actions hidden */
  disabled?: boolean;
  onSelectAsset: () => void;
  onRemoveAsset: () => void;
  onEditMetadata: () => void;
  onAssignmentChange: (updates: Partial<SlotAssignment>) => void;
};

/**
 * One slot of the layout, as a column: the name and the size of the slot,
 * then its asset (or the empty slot that adds one), then the options of the
 * asset.
 */
export default function SlotCard(props: Props) {
  if (props.assignment) {
    return <FilledSlot {...props} assignment={props.assignment} />;
  }
  return <EmptySlotContent {...props} />;
}

type SlotHeaderProps = {
  slot: LayoutSlot;
  widthOptions: WidthOption[];
  originalWidth?: number | null;
  originalHeight?: number | null;
};

/** The name of the slot, whether it needs an asset, and its size */
function SlotHeader({
  slot,
  widthOptions,
  originalWidth,
  originalHeight,
}: SlotHeaderProps) {
  return (
    <EntityRow
      layout="row"
      title={slotTitle(slot)}
      afterTitle={slot.required ? <Pill>Required</Pill> : undefined}
    >
      {describeSize({
        aspectRatio: slot.aspectRatio,
        customAspectRatio: slot.customAspectRatio,
        width: slot.width,
        widthOptions,
        originalWidth,
        originalHeight,
      })}
    </EntityRow>
  );
}

function EmptySlotContent({
  slot,
  widthOptions,
  disabled,
  onSelectAsset,
}: Props) {
  return (
    <>
      <SlotHeader slot={slot} widthOptions={widthOptions} />
      <EmptySlot
        message="No asset yet"
        action={
          disabled ? undefined : { label: 'Add asset', onClick: onSelectAsset }
        }
      />
    </>
  );
}

type ResolvedAssetData = {
  url: string;
  filename: string;
  originalWidth: number | null;
  originalHeight: number | null;
  format: string | null;
};

function resolveAssetData(
  assignment: SlotAssignment,
  upload: Upload | null,
): ResolvedAssetData {
  const url = assignment.url || upload?.attributes.url || '';
  const filename = assignment.filename || upload?.attributes.filename || '';
  const originalWidth =
    assignment.originalWidth ?? upload?.attributes.width ?? null;
  const originalHeight =
    assignment.originalHeight ?? upload?.attributes.height ?? null;
  const format = resolveFormat({
    format: assignment.format ?? upload?.attributes.format ?? null,
    url,
    filename,
  });
  return { url, filename, originalWidth, originalHeight, format };
}

/**
 * The assignment misses data that only the upload has: its URL, name or
 * format, or the original size that an Original width or aspect ratio needs.
 */
function determineNeedsFetch(
  assignment: SlotAssignment,
  slot: LayoutSlot,
): boolean {
  const baseFormat = resolveFormat({
    format: assignment.format,
    url: assignment.url,
    filename: assignment.filename,
  });
  const needsOriginalWidth =
    slot.width === 'original' || slot.aspectRatio === 'original';
  const needsOriginalHeight = slot.aspectRatio === 'original';
  return (
    !assignment.url ||
    !assignment.filename ||
    !baseFormat ||
    (needsOriginalWidth && !assignment.originalWidth) ||
    (needsOriginalHeight && !assignment.originalHeight)
  );
}

type FilledSlotProps = Props & { assignment: SlotAssignment };

type ReadyAssetProps = FilledSlotProps & { data: ResolvedAssetData };

/**
 * The asset of the slot in a card: Replace and Edit metadata on the media,
 * Remove in the "⋮" (a touch screen has them all in the "⋮"), then the
 * options of the asset. A read-only field shows the card alone.
 */
function ReadyAsset({
  slot,
  assignment,
  data,
  enableCssClass,
  enableLazyLoading,
  disabled,
  onSelectAsset,
  onRemoveAsset,
  onEditMetadata,
  onAssignmentChange,
}: ReadyAssetProps) {
  const menus = useMediaCardMenus(
    [
      { label: 'Replace', icon: ReplaceIcon, onClick: onSelectAsset },
      { label: 'Edit metadata', icon: EditIcon, onClick: onEditMetadata },
    ],
    onRemoveAsset,
  );
  const ratio = getEffectiveRatio(
    slot.aspectRatio,
    slot.customAspectRatio,
    data.originalWidth,
    data.originalHeight,
  );
  const caption = assetTitle({
    filename: data.filename,
    uploadId: assignment.uploadId,
  });
  const media = (
    <AssetMedia
      url={data.url}
      format={data.format}
      ratio={ratio}
      focalPoint={assignment.focalPoint}
    />
  );

  return (
    <>
      {disabled ? (
        <MediaCard caption={{ text: caption, muted: true }} disabled>
          {media}
        </MediaCard>
      ) : (
        <MediaCard
          caption={{ text: caption }}
          actions={menus.actions}
          options={menus.options}
        >
          {media}
        </MediaCard>
      )}
      {(enableCssClass || enableLazyLoading) && (
        // Its own box: the last field of the box drops its bottom margin
        <div>
          <AssetOptionFields
            value={assignment}
            enableCssClass={enableCssClass}
            enableLazyLoading={enableLazyLoading}
            disabled={disabled}
            onChange={onAssignmentChange}
          />
        </div>
      )}
    </>
  );
}

/**
 * A slot with an asset. When the assignment misses data, the upload loads
 * first: the slot says so, and offers to remove the asset when it fails.
 */
function FilledSlot(props: FilledSlotProps) {
  const { ctx, slot, assignment, widthOptions } = props;
  const needsFetch = determineNeedsFetch(assignment, slot);
  const { upload, error } = useUploadData(
    ctx,
    assignment.uploadId,
    !needsFetch,
  );
  const data = resolveAssetData(assignment, upload);
  const state = assetLoadState({
    needsFetch,
    url: assignment.url,
    uploadId: assignment.uploadId,
    upload,
    error,
  });

  return (
    <>
      <SlotHeader
        slot={slot}
        widthOptions={widthOptions}
        originalWidth={data.originalWidth}
        originalHeight={data.originalHeight}
      />
      {/* Under the header of the slot: content sits above the state */}
      {state === 'loading' && <LoadingAsset />}
      {state === 'failed' && (
        <FailedAsset
          filename={assignment.filename}
          disabled={props.disabled}
          onRemove={props.onRemoveAsset}
        />
      )}
      {state === 'ready' && <ReadyAsset {...props} data={data} />}
    </>
  );
}
