import { Canvas } from 'datocms-react-ui';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import type { ReactNode } from 'react';

type Props = {
  ctx: RenderPageCtx;
  title: string;
  description: string;
  toolbar: ReactNode;
  summary: ReactNode;
  results: ReactNode;
  detail: ReactNode;
};

export function PageShell({
  ctx,
  title,
  description,
  toolbar,
  summary,
  results,
  detail,
}: Props) {
  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className="env-diff-page">
        <header className="env-diff-page__header">
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="env-diff-page__toolbar">{toolbar}</div>
        </header>

        <section className="env-diff-page__summary">{summary}</section>

        <div className="env-diff-page__content">
          <section className="env-diff-page__results">{results}</section>
          <aside className="env-diff-page__detail">{detail}</aside>
        </div>
      </div>
    </Canvas>
  );
}
