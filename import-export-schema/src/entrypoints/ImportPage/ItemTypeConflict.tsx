import type { SchemaTypes } from '@datocms/cma-client';
import classNames from 'classnames';
import { useContext, useEffect, useRef } from 'react';
import { SelectedEntityContext } from './SelectedEntityContext';

type Props = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType: SchemaTypes.ItemType;
};

export function ItemTypeConflict({ exportItemType, projectItemType }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const selectedEntityContext = useContext(SelectedEntityContext);

  const isSelected = selectedEntityContext?.entity === exportItemType;

  useEffect(() => {
    if (isSelected) {
      elRef.current?.scrollIntoView();
    }
  }, [isSelected]);

  function handleSelect() {
    selectedEntityContext?.set(exportItemType, true);
  }

  return (
    <div
      className={classNames('conflict', isSelected && 'conflict--selected')}
      onClick={handleSelect}
      ref={elRef}
    >
      <div className="conflict__title">{exportItemType.attributes.name}</div>
      {isSelected && <div className="conflict__content">Content content.</div>}
    </div>
  );
}
