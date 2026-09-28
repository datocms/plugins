import { Toolbar, ToolbarStack, ToolbarTitle } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import { STRINGS } from './copy';

type TitleBarProps = {
  /** Toolbar meta ("9 matches in 4 records"); hidden below 600px, where `.fr-summary` repeats it. */
  meta?: string | null;
  /** The primary slot, always last. */
  children?: ReactNode;
};

/** Title ─ space ─ meta · slot. */
export function TitleBar({ meta = null, children }: TitleBarProps) {
  return (
    <Toolbar className="fr-toolbar">
      <ToolbarStack
        stackSize="s"
        style={{ gap: 'var(--spacing-m)', minWidth: 0 }}
      >
        <ToolbarTitle className="dl-toolbar__title">
          {STRINGS.title}
        </ToolbarTitle>
        <div className="dl-toolbar__space" />
        {meta && <span className="dl-toolbar__subtitle">{meta}</span>}
        {children}
      </ToolbarStack>
    </Toolbar>
  );
}
