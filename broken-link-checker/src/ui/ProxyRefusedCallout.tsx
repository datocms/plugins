import Callout from 'datocms-react-ui/Callout';

/**
 * Shown once for the whole report when the link checking service refused the
 * plugin's address: a setup problem, not a problem with the links.
 * `className` only places the callout (its margin in a spaced list).
 */
export function ProxyRefusedCallout({ className }: { className?: string }) {
  return (
    <Callout tone="warning" className={className}>
      No link could be checked: the link checking service only accepts this
      plugin when it's installed from the marketplace or run on localhost.
    </Callout>
  );
}
