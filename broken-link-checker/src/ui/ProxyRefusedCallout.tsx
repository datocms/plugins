import Callout from 'datocms-react-ui/Callout';

export const REFUSED_TITLE = "Links couldn't be checked";
/** Why, and what the editor can do about it. */
export const REFUSED_TEXT =
  "The link checking service only accepts this plugin when it's installed from the marketplace. Ask a project admin to install it from there.";

/**
 * Shown once for the whole report when the link checking service refused the
 * plugin's address: a setup problem, not a problem with the links.
 * `className` only places the callout (its margin in a spaced list).
 */
export function ProxyRefusedCallout({ className }: { className?: string }) {
  return (
    <Callout tone="warning" title={REFUSED_TITLE} className={className}>
      {REFUSED_TEXT}
    </Callout>
  );
}
