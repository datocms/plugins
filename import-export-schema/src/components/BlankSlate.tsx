import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
};

/**
 * Lightweight wrapper around the shared blank-slate markup so pages can focus on content.
 */
export function BlankSlate({ title, body, footer }: Props) {
  return (
    <div className="blank-slate">
      <div className="blank-slate__body">
        <div className="blank-slate__body__title">{title}</div>
        <div className="blank-slate__body__content">{body}</div>
      </div>
      {footer ? (
        <div className="blank-slate__body__outside">{footer}</div>
      ) : null}
    </div>
  );
}
