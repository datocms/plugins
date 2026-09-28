import { faFileMagnifyingGlass, Icon } from '../../ui/icons';
import { STRINGS } from './copy';

/** Before the first search: what the page does, and that nothing changes before review. */
export function IdleState() {
  return (
    <div className="dl-list-empty fr-idle">
      <div className="dl-list-empty__body">
        <div className="dl-list-empty__icon">
          <Icon glyph={faFileMagnifyingGlass} />
        </div>
        <div className="dl-list-empty__title">{STRINGS.idleTitle}</div>
        <div>{STRINGS.idleLine}</div>
      </div>
    </div>
  );
}
