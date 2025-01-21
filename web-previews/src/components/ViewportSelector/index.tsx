import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons';
import { Dropdown, DropdownMenu, DropdownOption } from 'datocms-react-ui';
import { type Viewport, DEFAULT_VIEWPORTS } from '../../types/viewport';
import styles from './styles.module.css';

interface ViewportSelectorProps {
  currentViewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
}

export function ViewportSelector({ currentViewport, onViewportChange }: ViewportSelectorProps) {
  return (
    <Dropdown
      renderTrigger={({ open, onClick }) => (
        <button
          type="button"
          className={styles.toolbarTitle}
          onClick={onClick}
          title="Select viewport"
        >
          <FontAwesomeIcon icon={currentViewport.icon} />
          <FontAwesomeIcon
            icon={open ? faCaretUp : faCaretDown}
            className={styles.toolbarTitleIcon}
          />
        </button>
      )}
    >
      <DropdownMenu>
        {DEFAULT_VIEWPORTS.map((viewport) => (
          <DropdownOption
            key={viewport.name}
            onClick={() => onViewportChange(viewport)}
            active={currentViewport.name === viewport.name}
          >
            <FontAwesomeIcon icon={viewport.icon} style={{ marginRight: '8px' }} />
            {viewport.name}
          </DropdownOption>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
} 