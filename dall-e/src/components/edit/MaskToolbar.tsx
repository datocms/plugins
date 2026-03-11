import s from '../../entrypoints/styles.module.css';

type MaskTool = 'draw' | 'erase';

type Props = {
  brushSize: number;
  canRedo: boolean;
  canUndo: boolean;
  onBrushSizeChange: (value: number) => void;
  onClear: () => void;
  onRedo: () => void;
  onUndo: () => void;
  onToolChange: (value: MaskTool) => void;
  tool: MaskTool;
};

export default function MaskToolbar({
  brushSize,
  canRedo,
  canUndo,
  onBrushSizeChange,
  onClear,
  onRedo,
  onToolChange,
  onUndo,
  tool,
}: Props) {
  return (
    <div className={s.maskToolbar}>
      <div className={s.maskToolRow}>
        <button
          className={`${s.smallChoice} ${tool === 'draw' ? s.smallChoiceActive : ''}`}
          type="button"
          onClick={() => onToolChange('draw')}
        >
          Brush
        </button>
        <button
          className={`${s.smallChoice} ${tool === 'erase' ? s.smallChoiceActive : ''}`}
          type="button"
          onClick={() => onToolChange('erase')}
        >
          Erase
        </button>
      </div>

      <label className={s.rangeField} htmlFor="maskBrushSize">
        <span className={s.rangeLabel}>Brush size</span>
        <div className={s.rangeRow}>
          <input
            id="maskBrushSize"
            className={s.rangeInput}
            min={4}
            max={120}
            step={1}
            type="range"
            value={brushSize}
            onChange={(event) => onBrushSizeChange(Number(event.target.value))}
          />
          <span className={s.rangeValue}>{brushSize}px</span>
        </div>
      </label>

      <div className={s.maskToolRow}>
        <button
          className={s.smallChoice}
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
        >
          Undo
        </button>
        <button
          className={s.smallChoice}
          type="button"
          disabled={!canRedo}
          onClick={onRedo}
        >
          Redo
        </button>
        <button className={s.smallChoice} type="button" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
