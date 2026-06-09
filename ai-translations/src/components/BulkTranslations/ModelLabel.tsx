/**
 * ModelLabel.tsx
 * --------------
 * A model rendered as a quiet label: the human name plus its api_key as a small
 * outlined code badge — not a chip. Used as the field-picker's field label and
 * in the confirm modal's breakdown so a model reads as a heading above its
 * field chips, rather than looking like just another chip.
 */
import s from './ModelLabel.module.css';

export function ModelLabel({ label, code }: { label: string; code: string }) {
  return (
    <span className={s.modelLabel}>
      {label}
      <code className={s.modelCode}>{code}</code>
    </span>
  );
}
