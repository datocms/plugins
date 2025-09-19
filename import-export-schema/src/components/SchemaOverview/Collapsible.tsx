import type { SchemaTypes } from '@datocms/cma-client';
import {
  faCaretRight as faCollapsed,
  faCaretDown as faExpanded,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import { type ReactNode, useContext, useEffect, useRef } from 'react';
import { SelectedEntityContext } from './SelectedEntityContext';

type Props = {
  entity: SchemaTypes.ItemType | SchemaTypes.Plugin;
  invalid?: boolean;
  hasConflict?: boolean;
  title: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Accordion-style wrapper that also syncs with the graph selection context.
 */
export default function Collapsible({
  entity,
  invalid,
  hasConflict = false,
  title,
  children,
  className,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null);

  const selectedEntityContext = useContext(SelectedEntityContext);
  const isSelected = selectedEntityContext.entity === entity;

  useEffect(() => {
    if (isSelected) {
      elRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isSelected]);

  function handleSelect() {
    if (isSelected) {
      selectedEntityContext.set(undefined, true);
    } else {
      selectedEntityContext.set(entity, true);
    }
  }

  return (
    <div
      className={classNames(
        'conflict',
        isSelected && 'conflict--selected',
        invalid && 'conflict--invalid',
        hasConflict && 'conflict--has-conflict',
        className,
      )}
      ref={elRef}
    >
      <button
        type="button"
        className="conflict__title"
        onClick={handleSelect}
        aria-expanded={isSelected}
        aria-controls={`conflict-panel-${entity.id}`}
        id={`conflict-button-${entity.id}`}
      >
        <FontAwesomeIcon icon={isSelected ? faExpanded : faCollapsed} />
        <span className="conflict__title__text">{title}</span>
        {hasConflict ? (
          <span className="conflict__badge" title="Conflicts detected">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <span>Conflict</span>
          </span>
        ) : null}
      </button>
      <section
        id={`conflict-panel-${entity.id}`}
        className="conflict__content"
        style={{ display: isSelected ? 'block' : 'none' }}
        aria-labelledby={`conflict-button-${entity.id}`}
      >
        {children}
      </section>
    </div>
  );
}
