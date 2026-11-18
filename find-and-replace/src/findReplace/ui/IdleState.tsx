import { faFileMagnifyingGlass, Icon } from '../../ui/icons';
import type { Copy } from './copy';

/** Before the first search: what the page does, and that nothing changes before review. */
export function IdleState({ copy }: { copy: Copy }) {
  return (
    <div className="dl-list-empty fr-idle">
      <div className="dl-list-empty__body">
        <div className="dl-list-empty__icon">
          <Icon glyph={faFileMagnifyingGlass} />
        </div>
        <div className="dl-list-empty__title">{copy.idleTitle}</div>
        <div>{copy.idleLine}</div>
      </div>
    </div>
  );
}
