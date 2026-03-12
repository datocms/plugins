import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import { type IconName, fas } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas, TextInput } from 'datocms-react-ui';
import { snakeCase } from 'lodash-es';
import { useMemo, useState } from 'react';
import s from './modal-styles.module.css';

export function IconPickerModal({ ctx }: { ctx: RenderModalCtx }) {
  const [searchQuery, setSearchQuery] = useState('');

  // Get all icon names
  const allIcons = useMemo(
    () =>
      Object.keys(fas)
        .map((iconName) =>
          snakeCase(iconName.replace(/^fa/, '')).replace(/_/g, '-'),
        )
        .sort(),
    [],
  );

  // Filter icons based on search query
  const allFilteredIcons = useMemo(() => {
    if (!searchQuery.trim()) {
      return allIcons;
    }
    const query = searchQuery.toLowerCase();
    return allIcons.filter((iconName) => iconName.includes(query));
  }, [allIcons, searchQuery]);

  const filteredIcons = allFilteredIcons.slice(0, 36);
  const hasMoreResults = allFilteredIcons.length > 36;

  const handleIconClick = (iconName: string) => {
    ctx.resolve(iconName);
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.container}>
        <div className={s.searchWrapper}>
          <TextInput
            id="icon-search"
            name="icon-search"
            placeholder="Search icons..."
            value={searchQuery}
            onChange={(newValue) => setSearchQuery(newValue)}
          />

          <div className={s.resultsInfo}>
            Showing {filteredIcons.length} of {allFilteredIcons.length} icon
            {allFilteredIcons.length !== 1 ? 's' : ''}
            {hasMoreResults && ' (refine your search to see more)'}
          </div>
        </div>

        <div className={s.grid}>
          {filteredIcons.map((iconName) => {
            const definition = findIconDefinition({
              prefix: 'fas',
              iconName: iconName as IconName,
            });

            return (
              <button
                key={iconName}
                type="button"
                className={s.iconButton}
                onClick={() => handleIconClick(iconName)}
                title={iconName}
              >
                {definition && (
                  <FontAwesomeIcon icon={definition} className={s.icon} />
                )}
                <span className={s.iconLabel}>{iconName}</span>
              </button>
            );
          })}
        </div>

        {filteredIcons.length === 0 && (
          <div className={s.noResults}>
            No icons found matching "{searchQuery}"
          </div>
        )}
      </div>
    </Canvas>
  );
}
