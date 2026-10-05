import { type ButtonProps, Button as KitButton } from 'datocms-react-ui';

/** The kit Button plus the drift fixes in kit-fixes.css. Use it everywhere. */
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
