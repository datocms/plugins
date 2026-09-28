import { Button } from '../../ui/Button';
import { faBan, faCircleExclamation, Icon } from '../../ui/icons';
import { type Copy, type PaneStateCase, STRINGS } from './copy';

type PaneStateProps = {
  pane: PaneStateCase;
  copy: Copy;
  /** Shows "Try again" when set. */
  onRetry?: () => void;
};

/** A whole-body state: no access, a load error or a failed search. */
export function PaneState({ pane, copy, onRetry }: PaneStateProps) {
  const text = copy.paneState(pane);

  return (
    <div className="dl-pane-state">
      <div className="dl-pane-state__icon">
        <Icon glyph={text.icon === 'ban' ? faBan : faCircleExclamation} />
      </div>
      <div className="dl-pane-state__title">{text.title}</div>
      <p>{text.line}</p>
      {onRetry && <Button onClick={onRetry}>{STRINGS.tryAgain}</Button>}
    </div>
  );
}
