import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { ArrowsRotateIcon, BanIcon, CircleExclamationIcon } from '../../icons';
import { type Copy, type PaneStateCase, STRINGS } from './copy';

type PageStateProps = {
  state: PaneStateCase;
  copy: Copy;
  /** Shows "Try again" when set. */
  onRetry?: () => void;
};

/**
 * The content of the page when there is nothing else to show: no access, a
 * load that failed, or a search that failed. Each is an error with its status
 * icon: the ban for a permission that is missing, the exclamation for the
 * rest. It centers in the content of the Pane. The raw error never shows: the
 * line says what happened.
 */
export function PageState({ state, copy, onRetry }: PageStateProps) {
  const text = copy.paneState(state);

  return (
    <BlankSlate
      placement="area"
      error
      icon={text.icon === 'ban' ? <BanIcon /> : <CircleExclamationIcon />}
      title={text.title}
      description={text.line}
      actions={
        onRetry ? (
          <Button
            icon={ArrowsRotateIcon}
            label={STRINGS.tryAgain}
            onClick={onRetry}
          />
        ) : undefined
      }
    />
  );
}

/** An area that loads, saying what loads ("Loading the models"). */
export function LoadingState({ title }: { title: string }) {
  return <BlankSlate placement="area" loading title={title} />;
}
