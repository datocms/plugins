import {
  type ButtonLinkProps,
  type ButtonProps,
  ButtonLink as KitButtonLink,
  Button as KitButton,
} from 'datocms-react-ui';

const kitClasses = (buttonType: string, className?: string) =>
  ['dl-kit-button', `dl-kit-button--${buttonType}`, className]
    .filter(Boolean)
    .join(' ');

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
      className={kitClasses(buttonType, className)}
    />
  );
}

export function ButtonLink({
  className,
  buttonType = 'muted',
  ...props
}: ButtonLinkProps) {
  return (
    <KitButtonLink
      {...props}
      buttonType={buttonType}
      className={kitClasses(buttonType, className)}
    />
  );
}
