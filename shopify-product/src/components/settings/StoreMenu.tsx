import { faStar, faTrashCan } from '@fortawesome/free-regular-svg-icons';
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
import { DropdownOption, DropdownSeparator } from 'datocms-react-ui';
import { Icon } from '../../ui/Icon';
import { Menu } from '../../ui/Menu';

type Props = {
  /** 1-based, for the accessible name. */
  position: number;
  isDefault: boolean;
  disabled: boolean;
  onMakeDefault: () => void;
  onRemove: () => void;
};

/** The ⋮ menu of a store block: Make default, then Remove store (last, red). */
export default function StoreMenu({
  position,
  isDefault,
  disabled,
  onMakeDefault,
  onRemove,
}: Props) {
  return (
    <Menu
      alignment="right"
      renderTrigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          type="button"
          className="dl-icon-button"
          aria-label={`Actions for store ${position}`}
          disabled={disabled}
        >
          <Icon icon={faEllipsisVertical} />
        </button>
      )}
    >
      {!isDefault && (
        <DropdownOption onClick={onMakeDefault}>
          <Icon icon={faStar} />
          Make default
        </DropdownOption>
      )}
      {!isDefault && <DropdownSeparator />}
      <DropdownOption red onClick={onRemove}>
        <Icon icon={faTrashCan} />
        Remove store
      </DropdownOption>
    </Menu>
  );
}
