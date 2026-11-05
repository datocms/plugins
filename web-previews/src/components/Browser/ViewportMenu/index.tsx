import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import EntityRow from 'datocms-react-ui/EntityRow';
import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';
import { useEffect } from 'react';
import {
  CustomSizeIcon,
  DisplayIcon,
  FitIcon,
  iconByName,
} from '../../../icons';
import { normalizeParameters, type Parameters } from '../../../types';
import { BoundedLabel } from '../../BoundedLabel';
import {
  isSameChoice,
  type ViewportChoice,
  type ViewportState,
} from '../viewport';
import { CustomSizeForm } from './CustomSizeForm';

type Props = {
  viewport: ViewportState;
  /**
   * The option that fits the page to the free space: "Fit to sidebar". The
   * trigger shows only "Fit", which the toolbar of a narrow frame can hold.
   */
  fitLabel: string;
  /**
   * The trigger shows only the icon of the choice, in a narrow frame: the
   * name of the choice is then its tooltip
   */
  iconOnly: boolean;
  /** Hides the menu, falling back to the fit, when the frame is narrower */
  minWidth?: number;
};

/**
 * The icon and the name of a choice, for the trigger. A preset has the name
 * that the settings give it, which can be long.
 */
function describe(choice: ViewportChoice) {
  if (choice === 'responsive') {
    return { icon: FitIcon, label: 'Fit', named: false };
  }

  if (choice === 'custom') {
    return { icon: CustomSizeIcon, label: 'Custom', named: false };
  }

  return {
    icon: iconByName(choice.icon) ?? DisplayIcon,
    label: choice.name,
    named: true,
  };
}

/**
 * The menu of the sizes of the preview: fit to the free space, the presets
 * of the plugin settings, or a size that the user types.
 */
export function ViewportMenu({
  viewport,
  fitLabel,
  iconOnly,
  minWidth = 0,
}: Props) {
  const { choice: value, setChoice: onChange } = viewport;
  const ctx = useCtx();
  const { defaultViewports } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const { icon, label, named } = describe(value);

  // The query reads the width of the frame. With no minimum it never matches
  const tooNarrow = useMediaQuery(`(max-width: ${minWidth - 0.02}px)`).matches;

  useEffect(() => {
    if (tooNarrow && value !== 'responsive') {
      onChange('responsive');
    }
  }, [tooNarrow, value, onChange]);

  if (tooNarrow) {
    return null;
  }

  return (
    <Dropdown
      triggerComponent={ButtonTrigger}
      tone="ghost"
      icon={icon}
      // Icon-only, the name is the accessible name and the tooltip. With
      // its label, the name of a preset stops at a short width, so the main
      // control of the bar keeps its width
      label={iconOnly || !named ? label : <BoundedLabel>{label}</BoundedLabel>}
      iconOnly={iconOnly}
    >
      {/* The trigger is near the right end of its bar, so the menu opens
          from its right edge: the kit flips a menu that has no space, but
          doesn't shift it */}
      <Dropdown.Menu placement="bottom-end">
        <Dropdown.Option
          active={value === 'responsive'}
          icon={<FitIcon />}
          onPick={() => onChange('responsive')}
        >
          {fitLabel}
        </Dropdown.Option>
        {defaultViewports.map((viewport) => {
          const ViewportIcon = iconByName(viewport.icon) ?? DisplayIcon;

          return (
            <Dropdown.Option
              key={`${viewport.name} ${viewport.width}×${viewport.height} ${viewport.icon}`}
              active={isSameChoice(value, viewport)}
              icon={<ViewportIcon />}
              onPick={() => onChange(viewport)}
            >
              <EntityRow
                layout="row"
                title={viewport.name}
                aside={`${viewport.width} × ${viewport.height}`}
              />
            </Dropdown.Option>
          );
        })}
        <Dropdown.Separator />
        <CustomSizeForm
          size={viewport.customSize}
          onApply={(size) => {
            viewport.setCustomSize(size);
            onChange('custom');
          }}
        />
      </Dropdown.Menu>
    </Dropdown>
  );
}
