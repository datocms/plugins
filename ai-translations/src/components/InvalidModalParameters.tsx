/**
 * InvalidModalParameters.tsx
 * --------------------------
 * What a translation dialog shows when it was opened without valid
 * parameters: an error blank slate with a Close button. The dialogs open
 * with no host cross, so Close and Escape are the ways out.
 */
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { CircleExclamationIcon } from '../icons';
import { useCloseOnEscape } from './useCloseOnEscape';

type Props = {
  /** Closes the dialog with the value that a dismissal means to its caller. */
  onClose: () => void;
};

export default function InvalidModalParameters({ onClose }: Props) {
  useCloseOnEscape(onClose);

  return (
    <BlankSlate
      placement="inline"
      error
      icon={<CircleExclamationIcon />}
      title="Couldn't open this window"
      description="Some of its information is missing. Close it and try again."
      actions={<Button label="Close" onClick={onClose} />}
    />
  );
}
