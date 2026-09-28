import type { ReactNode } from 'react';

/** Replaces an empty page body: a title, one or two neutral lines, then an optional action. */
export function BlankSlate({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="dl-blank-slate">
      <h2 className="dl-blank-slate__title">{title}</h2>
      <div className="dl-blank-slate__description">{children}</div>
      {action}
    </div>
  );
}
