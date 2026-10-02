/**
 * Button.tsx
 * ----------
 * Thin wrappers around the kit's `Button` and `ButtonLink` that add the
 * `dl-kit-button dl-kit-button--{buttonType}` classes targeted by
 * `src/kit-fixes.css` (icon ink, keyboard focus ring, focused-primary fill).
 * Import these instead of the kit's buttons on redesigned surfaces.
 */
import {
  type ButtonLinkProps,
  type ButtonProps,
  Button as KitButton,
  ButtonLink as KitButtonLink,
} from 'datocms-react-ui';

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
