import { type ButtonProps, Button as KitButton } from 'datocms-react-ui';

// The kit's Button with the dashboard's icon color, focus ring and focused
// primary fill (see src/kit-fixes.css). Import it instead of the kit's.
export function Button({
  className,
  buttonType = 'muted',
  ...props
}: ButtonProps) {
  return (
    <KitButton
      {...props}
      buttonType={buttonType}
      className={['dl-kit-button', `dl-kit-button--${buttonType}`, className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
