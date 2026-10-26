import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import { BoundedLabel } from '../../../../../components/BoundedLabel';
import type { Frontend } from '../../../../../types';

type Props = {
  frontends: Frontend[];
  currentFrontend: Frontend;
  onChange: (frontend: Frontend) => void;
};

/**
 * The menu of the frontends with visual editing, at the start of the bar,
 * before the address: the trigger shows the name of the frontend of the
 * preview, and a pick loads the other one.
 */
export function FrontendSelector({
  frontends,
  currentFrontend,
  onChange,
}: Props) {
  return (
    <Dropdown
      triggerComponent={ButtonTrigger}
      tone="ghost"
      // A long frontend name stops at a short width, so the address keeps
      // its width
      label={<BoundedLabel>{currentFrontend.name}</BoundedLabel>}
    >
      <Dropdown.Menu>
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
