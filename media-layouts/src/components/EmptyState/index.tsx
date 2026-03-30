import { Button } from 'datocms-react-ui';
import s from './styles.module.css';

type Props = {
  isGallery: boolean;
  onSelectAsset: () => void;
  disabled?: boolean;
};

export default function EmptyState({
  isGallery,
  onSelectAsset,
  disabled,
}: Props) {
  return (
    <div className={s.emptyState}>
      <div className={s.icon}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
      <p className={s.text}>
        {isGallery ? 'No assets selected' : 'No asset selected'}
      </p>
      <Button
        onClick={onSelectAsset}
        disabled={disabled}
        buttonSize="s"
      >
        {isGallery ? 'Add assets' : 'Browse assets'}
      </Button>
    </div>
  );
}
