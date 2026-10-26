import { Fragment } from 'react';

/** The docs of a section, in one line under its description */
export function DocLinks({
  links,
}: {
  links: { href: string; label: string }[];
}) {
  return (
    <p>
      Docs:{' '}
      {links.map(({ href, label }, index) => (
        <Fragment key={href}>
          {index > 0 && ' · '}
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        </Fragment>
      ))}
    </p>
  );
}
