import styles from './styles.module.css';

const isMac = navigator.platform.indexOf('Mac') > -1;
const modifierKey = isMac ? '⌘' : 'Ctrl';

export function HotKey({
  hotkey,
  label,
}: {
  hotkey: string;
  label?: string;
}) {
  const keys = hotkey
    .replace('mod', modifierKey)
    .replace('alt', isMac ? '⌥' : 'Alt')
    .split(/\+/)
    .map((e) => e.charAt(0).toUpperCase() + e.slice(1));

  return (
    <div className={styles.hotKey}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.keys}>
        {keys.map((key) => (
          <span key={key} className={styles.hotKeyKey}>
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}
