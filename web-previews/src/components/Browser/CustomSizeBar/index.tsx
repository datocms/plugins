import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import Toolbar from 'datocms-react-ui/Toolbar';
import { parseDimension, type ViewportSize } from '../viewport';
import styles from './styles.module.css';

type Props = {
  size: ViewportSize;
  onChange: (size: ViewportSize) => void;
};

/** A dimension of 0 is one that the user has not typed */
function sizeError({ width, height }: ViewportSize): string | undefined {
  if (!width && !height) {
    return 'Enter a width and a height';
  }

  if (!width) {
    return 'Enter a width';
  }

  if (!height) {
    return 'Enter a height';
  }

  return undefined;
}

/** A missing dimension shows an empty input, thus the user can clear it */
function dimensionText(value: number): string {
  return value ? String(value) : '';
}

/**
 * The bar of fields under the toolbar, while the preview has a custom size.
 * It is a plain fields bar, as the filter row of a list: the short style is
 * lower than a field, so the box would touch its edges.
 */
export function CustomSizeBar({ size, onChange }: Props) {
  return (
    <Toolbar fields>
      {/* The group names itself and each input names itself, so the field
          has no label: a hidden one would still take room above the box */}
      <FieldWrapper
        error={sizeError(size)}
        container={{ className: styles.field }}
      >
        <InputGroup.Root inline ariaLabel="Custom size in pixels">
          <InputGroup.Input
            ariaLabel="Width"
            inputMode="numeric"
            size={5}
            value={dimensionText(size.width)}
            onChange={(value) =>
              onChange({ ...size, width: parseDimension(value) })
            }
          />
          <InputGroup.Addon>×</InputGroup.Addon>
          <InputGroup.Input
            ariaLabel="Height"
            inputMode="numeric"
            size={5}
            value={dimensionText(size.height)}
            onChange={(value) =>
              onChange({ ...size, height: parseDimension(value) })
            }
          />
          <InputGroup.Addon>px</InputGroup.Addon>
        </InputGroup.Root>
      </FieldWrapper>
    </Toolbar>
  );
}
