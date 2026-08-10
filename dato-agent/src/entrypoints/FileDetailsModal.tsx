import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import styles from './FileDetailsModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

function stringParameter(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function nonNegativeNumberParameter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function formatFileSize(size: number | undefined): string {
  if (size === undefined) return 'Unknown';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatLastModified(timestamp: number | undefined): string {
  if (timestamp === undefined || timestamp === 0) return 'Unknown';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

export default function FileDetailsModal({ ctx }: Props) {
  const filename = stringParameter(ctx.parameters.filename, 'Untitled file');
  const mimeType = stringParameter(
    ctx.parameters.mimeType,
    'application/octet-stream',
  );
  const size = nonNegativeNumberParameter(ctx.parameters.size);
  const lastModified = nonNegativeNumberParameter(ctx.parameters.lastModified);
  const bytesAvailable = ctx.parameters.bytesAvailable === true;

  return (
    <Canvas ctx={ctx}>
      <div className={styles.root}>
        <section className={styles.status} aria-label="File status">
          <strong>This file is not yet a DatoCMS asset.</strong>
          <p>
            {bytesAvailable
              ? 'File bytes are available only for this browser session.'
              : 'The file bytes are no longer available; only its metadata remains.'}
          </p>
        </section>

        <dl className={styles.metadata}>
          <div>
            <dt>Filename</dt>
            <dd>{filename}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{mimeType}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatFileSize(size)}</dd>
          </div>
          <div>
            <dt>Last modified</dt>
            <dd>{formatLastModified(lastModified)}</dd>
          </div>
        </dl>
      </div>
    </Canvas>
  );
}
