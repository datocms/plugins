import s from './styles.module.css';

export function SendActivityGlyph({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className={s.sendProgress} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function WorkingInline({ label }: { label: string }) {
  return (
    <div className={s.thinking} role="status" aria-live="polite">
      <span className={s.activityPulse} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
