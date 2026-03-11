import {
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { WorkingImage } from '../../utils/inputImages';
import s from '../../entrypoints/styles.module.css';

export type SelectionRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type MaskStageHandle = {
  clear: () => void;
};

type Props = {
  image: WorkingImage;
  onSelectionChange: (value?: SelectionRect) => void;
  scope: 'full' | 'mask';
  selection?: SelectionRect;
};

type DragState = {
  originX: number;
  originY: number;
};

const MIN_SELECTION_SIZE = 12;

const MaskStage = forwardRef<MaskStageHandle, Props>(function MaskStage(
  { image, onSelectionChange, scope, selection },
  ref,
) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | undefined>(
    selection,
  );

  useEffect(() => {
    setDraftSelection(selection);
  }, [selection]);

  const readNormalizedPoint = useCallback((event: PointerEvent | ReactPointerEvent<HTMLDivElement>) => {
    const imageElement = imageRef.current;

    if (!imageElement) {
      return null;
    }

    const rect = imageElement.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      return null;
    }

    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    return {
      imageHeight: image.height ?? image.originalHeight,
      imageWidth: image.width ?? image.originalWidth,
      rectHeight: rect.height,
      rectWidth: rect.width,
      x,
      y,
    };
  }, [image.height, image.originalHeight, image.originalWidth, image.width]);

  const toSelectionRect = useCallback((start: DragState, nextX: number, nextY: number, rectWidth: number, rectHeight: number, imageWidth: number, imageHeight: number): SelectionRect | undefined => {
    const left = Math.min(start.originX, nextX);
    const top = Math.min(start.originY, nextY);
    const width = Math.abs(nextX - start.originX);
    const height = Math.abs(nextY - start.originY);

    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      return undefined;
    }

    return {
      x: Math.round((left / rectWidth) * imageWidth),
      y: Math.round((top / rectHeight) * imageHeight),
      width: Math.round((width / rectWidth) * imageWidth),
      height: Math.round((height / rectHeight) * imageHeight),
    };
  }, []);

  const finishDrag = useCallback((event?: PointerEvent | ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState) {
      return;
    }

    dragStateRef.current = null;

    if (!event) {
      return;
    }

    const point = readNormalizedPoint(event);

    if (!point) {
      return;
    }

    const nextSelection = toSelectionRect(
      dragState,
      point.x,
      point.y,
      point.rectWidth,
      point.rectHeight,
      point.imageWidth,
      point.imageHeight,
    );

    setDraftSelection(nextSelection);
    onSelectionChange(nextSelection);
  }, [onSelectionChange, readNormalizedPoint, toSelectionRect]);

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      finishDrag(event);
    };

    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [finishDrag]);

  useImperativeHandle(ref, () => ({
    clear() {
      dragStateRef.current = null;
      setDraftSelection(undefined);
      onSelectionChange(undefined);
    },
  }), [onSelectionChange]);

  const displayedSelection = draftSelection || selection;

  return (
    <div className={s.maskStageRoot}>
      <div className={s.maskStageViewport}>
        <div className={s.maskStageCanvasWrap}>
          <img
            alt="Source"
            className={s.maskStageImage}
            ref={imageRef}
            src={image.dataUrl}
          />
          <div
            className={`${s.maskStageOverlay} ${scope === 'mask' ? s.maskStageOverlayActive : ''}`}
            onPointerDown={(event) => {
              if (scope !== 'mask') {
                return;
              }

              const point = readNormalizedPoint(event);

              if (!point) {
                return;
              }

              event.preventDefault();
              dragStateRef.current = {
                originX: point.x,
                originY: point.y,
              };
              setDraftSelection(undefined);
            }}
            onPointerMove={(event) => {
              const dragState = dragStateRef.current;

              if (!dragState) {
                return;
              }

              const point = readNormalizedPoint(event);

              if (!point) {
                return;
              }

              event.preventDefault();
              const nextSelection = toSelectionRect(
                dragState,
                point.x,
                point.y,
                point.rectWidth,
                point.rectHeight,
                point.imageWidth,
                point.imageHeight,
              );
              setDraftSelection(nextSelection);
            }}
          >
            {displayedSelection && (
              <SelectionOverlay image={image} selection={displayedSelection} />
            )}
          </div>
        </div>

        {scope === 'mask' && !displayedSelection && (
          <div className={s.maskStageHint}>Drag a box over the area you want to change.</div>
        )}
      </div>
    </div>
  );
});

export default MaskStage;

function SelectionOverlay({
  image,
  selection,
}: {
  image: WorkingImage;
  selection: SelectionRect;
}) {
  const imageWidth = image.width ?? image.originalWidth;
  const imageHeight = image.height ?? image.originalHeight;
  const left = (selection.x / imageWidth) * 100;
  const top = (selection.y / imageHeight) * 100;
  const width = (selection.width / imageWidth) * 100;
  const height = (selection.height / imageHeight) * 100;

  return (
    <div
      className={s.selectionRect}
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
      }}
    >
      <div className={s.selectionRectLabel}>Selected area</div>
    </div>
  );
}
