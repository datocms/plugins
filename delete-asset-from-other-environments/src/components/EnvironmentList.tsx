import { useState } from 'react';
import type { Environment } from '../utils/assetEnvironmentOperations';
import { EnvItem } from './EnvItem';

const ROW_HEIGHT = 28;
const VISIBLE_ROWS = 12;
const OVERSCAN = 4;

export function EnvironmentList({
  environments,
  ...props
}: {
  environments: Environment[];
  currentEnv: string;
  uploadId: string;
  projectDomain: string | null;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  if (environments.length <= 100) {
    return (
      <ol>
        {environments.map((env) => (
          <EnvItem key={env.id} env={env} {...props} />
        ))}
      </ol>
    );
  }
  const start = Math.max(
    0,
    Math.min(
      environments.length - VISIBLE_ROWS,
      Math.floor(scrollTop / ROW_HEIGHT),
    ) - OVERSCAN,
  );
  const visible = environments.slice(
    start,
    start + VISIBLE_ROWS + 2 * OVERSCAN,
  );
  return (
    <div
      style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS, overflow: 'auto' }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      tabIndex={0}
      role="region"
      aria-label="Other environments containing this asset"
    >
      <div
        style={{
          height: environments.length * ROW_HEIGHT,
          position: 'relative',
        }}
      >
        <ol
          start={start + 1}
          style={{
            position: 'absolute',
            top: start * ROW_HEIGHT,
            margin: 0,
            lineHeight: `${ROW_HEIGHT}px`,
            whiteSpace: 'nowrap',
          }}
        >
          {visible.map((env) => (
            <EnvItem key={env.id} env={env} {...props} />
          ))}
        </ol>
      </div>
    </div>
  );
}
