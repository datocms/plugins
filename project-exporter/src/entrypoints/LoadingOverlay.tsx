import { Button, Spinner } from 'datocms-react-ui';
import s from './styles.module.css';

type Props = {
  status: string;
  progress?: number;
  onCancel?: () => void;
};

export default function LoadingOverlay({ status, progress, onCancel }: Props) {
  return (
    <div className={s.overlay}>
      <div className={s.overlayContent}>
        <div className={s.spinnerContainer}>
          <Spinner size={48} />
        </div>
        <div className={s.overlayText}>{status}</div>
        {progress !== undefined && progress >= 0 && (
          <>
            <div className={s.progressBarContainer}>
              <div
                className={s.progressBarFill}
                style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
              />
            </div>
            <div className={s.progressText}>{Math.round(progress)}%</div>
          </>
        )}
        {onCancel && (
          <>
            <div className={s.progressText}>
              Large exports create multiple files. Allow multiple downloads in
              your browser.
            </div>
            <Button onClick={onCancel}>Cancel export</Button>
          </>
        )}
      </div>
    </div>
  );
}
