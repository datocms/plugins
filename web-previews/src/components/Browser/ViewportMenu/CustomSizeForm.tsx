import Button from 'datocms-react-ui/Button';
import { useCloseMenu } from 'datocms-react-ui/Dropdown';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import InputGroup from 'datocms-react-ui/InputGroup';
import { type FormEvent, useState } from 'react';
import { parseDimension, type ViewportSize } from '../viewport';

type Props = {
  size: ViewportSize;
  onApply: (size: ViewportSize) => void;
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
 * The form of the custom size, at the end of the viewport menu: a field and
 * a submit button, as the kit gives a typed value in a menu. The menu
 * renders it only while it is open, thus the fields start from the current
 * size each time. The size applies on submit: the preview does not jump at
 * each digit.
 */
export function CustomSizeForm({ size: initialSize, onApply }: Props) {
  const closeMenu = useCloseMenu();
  const [size, setSize] = useState(initialSize);
  const [submitted, setSubmitted] = useState(false);
  const error = sizeError(size);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);

    if (!error) {
      onApply(size);
      closeMenu();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="Dropdown__menu__body">
        <FieldWrapper label="Custom size" error={submitted ? error : undefined}>
          <InputGroup.Root inline ariaLabel="Custom size in pixels">
            <InputGroup.Input
              ariaLabel="Width"
              inputMode="numeric"
              size={5}
              value={dimensionText(size.width)}
              onChange={(value) =>
                setSize({ ...size, width: parseDimension(value) })
              }
            />
            <InputGroup.Addon>×</InputGroup.Addon>
            <InputGroup.Input
              ariaLabel="Height"
              inputMode="numeric"
              size={5}
              value={dimensionText(size.height)}
              onChange={(value) =>
                setSize({ ...size, height: parseDimension(value) })
              }
            />
            <InputGroup.Addon>px</InputGroup.Addon>
          </InputGroup.Root>
        </FieldWrapper>
        <Button tone="primary" size="milli" expand submit label="Apply" />
      </div>
    </form>
  );
}
