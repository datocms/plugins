// Import this everywhere instead of the kit's Button
import { type ButtonProps, Button as KitButton } from 'datocms-react-ui';

const kitClasses = (buttonType: string, className?: string) =>
  ['dl-kit-button', `dl-kit-button--${buttonType}`, className]
    .filter(Boolean)
    .join(' ');

export function Button({
  className,
  buttonType = 'muted',
  ...props
}: ButtonProps) {
  return (
    <KitButton
      {...props}
      buttonType={buttonType}
      className={kitClasses(buttonType, className)}
    />
  );
}
