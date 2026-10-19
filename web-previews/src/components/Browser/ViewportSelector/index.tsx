import { findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faExpand,
  faMobileAlt,
  faRuler,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import {
  Dropdown,
  DropdownMenu,
  DropdownOption,
  useCtx,
} from 'datocms-react-ui';
import { useEffect } from 'react';
import { useWindowSize } from 'usehooks-ts';
import {
  normalizeParameters,
  type Parameters,
  type Viewport,
} from '../../../types';
import { ToolbarButton } from '../Toolbar/ToolbarButton';
import styles from './styles.module.css';

/**
 * Below this frame width the toolbar has no room for the selector. The frame
 * width is the space actually available to the preview, not a setting.
 */
const MIN_FRAME_WIDTH = 600;

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
  const { width } = useWindowSize();
  const hidden = width < MIN_FRAME_WIDTH;

  useEffect(() => {
    if (hidden && currentViewport !== 'responsive') {
      onChange('responsive');
    }
  }, [hidden, currentViewport, onChange]);

  const ctx = useCtx<RenderItemFormSidebarCtx>();

  const { defaultViewports } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  if (hidden) {
    return null;
  }

  return (
    <div className={styles.root}>
      <Dropdown
        renderTrigger={({ onClick }) => (
          <ToolbarButton
            icon={faMobileAlt}
            tooltip="Change viewport size"
            onClick={onClick}
          />
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
