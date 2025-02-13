import {
  faCaretRight as faCollapsed,
  faCaretDown as faExpanded,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import { type ReactNode, forwardRef } from 'react';

type Props = {
  open: boolean;
  invalid: boolean;
  onToggle: () => void;
  title: ReactNode;
  children: ReactNode;
};

const Collapsible = forwardRef<HTMLDivElement, Props>(
  ({ open, invalid, onToggle, title, children }, ref) => {
    return (
      <div
        className={classNames(
          'conflict',
          open && 'conflict--selected',
          invalid && 'conflict--invalid',
        )}
        ref={ref}
      >
        <div className="conflict__title" onClick={onToggle}>
          <FontAwesomeIcon icon={open ? faExpanded : faCollapsed} /> {title}
        </div>
        <div
          className="conflict__content"
          style={{ display: open ? 'block' : 'none' }}
        >
          {children}
        </div>
      </div>
    );
  },
);

export default Collapsible;
