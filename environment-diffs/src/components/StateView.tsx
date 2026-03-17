import type { ReactNode } from 'react';

type Props = {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: 'default' | 'error';
};

export function StateView({
  title,
  message,
  action,
  tone = 'default',
}: Props) {
  return (
    <div className={`state-view state-view--${tone}`}>
      <h2>{title}</h2>
      <p>{message}</p>
      {action ? <div className="state-view__action">{action}</div> : null}
    </div>
  );
}
