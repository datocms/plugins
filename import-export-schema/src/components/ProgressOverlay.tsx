import Modal from 'datocms-react-ui/Modal';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import { useFormatters } from '@/texts';
import ProgressStallNotice from './ProgressStallNotice';
import s from './progress.module.css';

type CancelProps = {
  /** Stops the task, or asks first whether to stop it */
  onCancel: () => void | Promise<void>;
};

type ProgressData = {
  label?: string;
  done?: number;
  total?: number;
};

type Props = {
  title: string;
  /** One line under the title, for example the state of a cancel */
  description?: string;
  progress: ProgressData;
  stallCurrent?: number | undefined;
  /** The name of the progress bar. The default is the title. */
  ariaLabel?: string;
  /**
   * How the user stops the task: the Cancel button of the footer, and Escape.
   * Without it (for example once a cancel is requested), the dialog has no
   * footer and cannot be closed.
   */
  cancel?: CancelProps;
};

/**
 * The dialog of a long task: it blocks the page, shows the progress and lets
 * the user stop the task with the Cancel of its footer. It has no close
 * button: it goes away when the task ends.
 */
export function ProgressOverlay({
  title,
  description,
  progress,
  stallCurrent,
  ariaLabel,
  cancel,
}: Props) {
  const format = useFormatters();
  const { label = '', done = 0, total } = progress;
  const hasShare = typeof total === 'number' && total > 0;

  return (
    <Modal
      title={title}
      freeContent
      onClose={
        cancel
          ? () => {
              void cancel.onCancel();
            }
          : null
      }
    >
      <Modal.Body>
        <div className={s.body}>
          {description ? <p className={s.description}>{description}</p> : null}
          {hasShare ? (
            <div className={s.progress}>
              <ProgressBar
                value={done / total}
                ariaLabel={ariaLabel ?? title}
              />
              <div className={s.meta}>
                <span className={s.label}>{label}</span>
                <span className={s.count}>
                  {format.number(done)} of {format.number(total)}
                </span>
              </div>
            </div>
          ) : (
            <div className={s.status}>
              <Spinner inline label={false} />
              <span className={s.label}>{label}</span>
            </div>
          )}
          <ProgressStallNotice current={stallCurrent} />
        </div>
      </Modal.Body>
      {/* The footer draws its own Cancel at the left, from onClose. The
          task has no other action. */}
      {cancel ? <Modal.Footer>{null}</Modal.Footer> : null}
    </Modal>
  );
}
