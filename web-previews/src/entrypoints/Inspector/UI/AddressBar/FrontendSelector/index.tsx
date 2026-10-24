import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import { BoundedLabel } from '../../../../../components/BoundedLabel';
import { GlobeIcon } from '../../../../../icons';
import type { Frontend } from '../../../../../types';

type Props = {
  frontends: Frontend[];
  currentFrontend: Frontend;
  onChange: (frontend: Frontend) => void;
  /**
   * The trigger shows only the icon, in a very narrow frame only, where its
   * name would leave the address no usable width: the name is then its
   * tooltip, and the menu marks it as the active option
   */
  iconOnly: boolean;
};

/**
 * The menu of the frontends with visual editing: the trigger shows the
 * frontend of the preview, and a pick loads the other one.
 *
 * The icon of the trigger is the same for every frontend, so the trigger
 * keeps the name, which is the current value, as long as the bar has room
 * for it. In a narrow frame the viewport menu, whose icon is its current
 * choice, goes icon-only first.
 */
export function FrontendSelector({
  frontends,
  currentFrontend,
  onChange,
  iconOnly,
}: Props) {
  return (
    <Dropdown
      triggerComponent={ButtonTrigger}
      tone="ghost"
      icon={GlobeIcon}
      // Icon-only, the name is the accessible name and the tooltip. With
      // its label, a long frontend name stops at a short width, so the
      // address keeps its width
      label={
        iconOnly ? (
          currentFrontend.name
        ) : (
          <BoundedLabel>{currentFrontend.name}</BoundedLabel>
        )
      }
      iconOnly={iconOnly}
    >
      <Dropdown.Menu placement="bottom-end">
        {frontends.map((frontend) => (
          <Dropdown.Option
            key={frontend.name}
            active={frontend.name === currentFrontend.name}
            onPick={() => onChange(frontend)}
          >
            {frontend.name}
          </Dropdown.Option>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
