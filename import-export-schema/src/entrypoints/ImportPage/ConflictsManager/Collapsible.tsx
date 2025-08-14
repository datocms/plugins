import type { SchemaTypes } from '@datocms/cma-client';
import {
  faCaretRight as faCollapsed,
  faCaretDown as faExpanded,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import { type ReactNode, useContext, useEffect, useRef } from 'react';
import { SelectedEntityContext } from '../SelectedEntityContext';

type Props = {
  entity: SchemaTypes.ItemType | SchemaTypes.Plugin;
  invalid?: boolean;
  title: ReactNode;
  children: ReactNode;
};

export default function Collapsible({
  entity,
  invalid,
  title,
  children,
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
        <FontAwesomeIcon icon={isSelected ? faExpanded : faCollapsed} /> {title}
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
