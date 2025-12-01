import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faExpand, faRuler } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import {
  Dropdown,
  DropdownMenu,
  DropdownOption,
  useCtx,
} from 'datocms-react-ui';
import {
  type Parameters,
  type Viewport,
  normalizeParameters,
} from '../../../types';
import styles from './styles.module.css';

interface ViewportSelectorProps {
  menuAlignment: 'left' | 'right';
  currentViewport: Viewport | 'responsive' | 'custom';
  onChange: (viewport: Viewport | 'responsive' | 'custom') => void;
}

export function ViewportSelector({
  menuAlignment,
  currentViewport,
  onChange,
}: ViewportSelectorProps) {
  const ctx = useCtx<RenderItemFormSidebarCtx>();

  const { defaultViewports } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  return (
    <div className={styles.root}>
      <Dropdown
        renderTrigger={({ onClick }) => (
          <button
            type="button"
            className={styles.button}
            onClick={onClick}
            title="Change viewport size"
          >
            <FontAwesomeIcon
              icon={
                currentViewport === 'responsive'
                  ? faExpand
                  : currentViewport === 'custom'
                    ? faRuler
                    : findIconDefinition({
                        prefix: 'fas',
                        iconName: currentViewport.icon,
                      })
              }
            />
          </button>
        )}
      >
        <DropdownMenu alignment={menuAlignment}>
          <DropdownOption
            onClick={() => onChange('responsive')}
            active={currentViewport === 'responsive'}
          >
            <FontAwesomeIcon icon={faExpand} style={{ marginRight: '8px' }} />
            Fit to sidebar
          </DropdownOption>
          {defaultViewports.map((viewport) => {
            const iconDefinition = findIconDefinition({
              prefix: 'fas',
              iconName: viewport.icon,
            });

            return (
              <DropdownOption
                key={viewport.name}
                onClick={() => onChange(viewport)}
                active={
                  typeof currentViewport === 'object' &&
                  'icon' in currentViewport &&
                  currentViewport.name === viewport.name
                }
              >
                <FontAwesomeIcon
                  icon={iconDefinition}
                  style={{ marginRight: '8px' }}
                />
                {viewport.name}
              </DropdownOption>
            );
          })}
          <DropdownOption
            onClick={() => onChange('custom')}
            active={currentViewport === 'custom'}
          >
            <FontAwesomeIcon icon={faRuler} style={{ marginRight: '8px' }} />
            Custom
          </DropdownOption>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
