import { faCaretDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dropdown, DropdownMenu, DropdownOption } from 'datocms-react-ui';
import type { Frontend } from '../../../../../types';
import styles from './styles.module.css';

type Props = {
  frontends: Frontend[];
  currentFrontend: Frontend;
  onChange: (frontend: Frontend) => void;
};

export function FrontendSelector({
  frontends,
  currentFrontend,
  onChange,
}: Props) {
  return (
    <Dropdown
      renderTrigger={({ onClick }) => (
        <button type="button" onClick={onClick} className={styles.trigger}>
          <span className={styles.label}>{currentFrontend.name}</span>
          <FontAwesomeIcon icon={faCaretDown} className={styles.icon} />
          <span className={styles.separator}>·</span>
        </button>
      )}
    >
      <DropdownMenu>
        {frontends.map((frontend) => (
          <DropdownOption
            key={frontend.name}
            onClick={() => onChange(frontend)}
            active={frontend.name === currentFrontend.name}
          >
            {frontend.name}
          </DropdownOption>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
