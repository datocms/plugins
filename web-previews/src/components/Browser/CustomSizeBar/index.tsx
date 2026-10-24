import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import Toolbar from 'datocms-react-ui/Toolbar';
import { parseDimension, type ViewportSize } from '../viewport';

type Props = {
  size: ViewportSize;
  onChange: (size: ViewportSize) => void;
};

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
      <FieldWrapper>
        <InputGroup.Root inline ariaLabel="Custom size in pixels">
          <InputGroup.Input
            ariaLabel="Width"
            inputMode="numeric"
            size={5}
            value={String(size.width)}
            onChange={(value) =>
              onChange({ ...size, width: parseDimension(value) })
            }
          />
          <InputGroup.Addon>×</InputGroup.Addon>
          <InputGroup.Input
            ariaLabel="Height"
            inputMode="numeric"
            size={5}
            value={String(size.height)}
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
