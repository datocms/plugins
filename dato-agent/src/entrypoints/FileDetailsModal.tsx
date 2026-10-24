import type { RenderModalCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import InfoList from 'datocms-react-ui/InfoList';
import SmartDate from 'datocms-react-ui/SmartDate';
import type { CSSProperties } from 'react';
import { TEXTS } from '../texts';

type Props = {
  ctx: RenderModalCtx;
};

// A filename or a type with no spaces breaks anywhere, so it stays in its row
const BREAK_ANYWHERE: CSSProperties = { overflowWrap: 'anywhere' };

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

function lastModifiedDate(timestamp: number | undefined): Date | undefined {
  if (timestamp === undefined || timestamp === 0) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function FileDetailsModal({ ctx }: Props) {
  const filename = stringParameter(ctx.parameters.filename, 'Untitled file');
  const mimeType = stringParameter(
    ctx.parameters.mimeType,
    'application/octet-stream',
  );
  const size = nonNegativeNumberParameter(ctx.parameters.size);
  const lastModified = lastModifiedDate(
    nonNegativeNumberParameter(ctx.parameters.lastModified),
  );
  const bytesAvailable = ctx.parameters.bytesAvailable === true;

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      <Callout title="Not a DatoCMS asset yet" tone="warning">
        {bytesAvailable
          ? 'Its content is available only in this browser session.'
          : 'Its content is no longer available. Only its details remain.'}
      </Callout>
      <InfoList>
        <InfoList.Row title="Filename">
          <span style={BREAK_ANYWHERE}>{filename}</span>
        </InfoList.Row>
        <InfoList.Row title="Type">
          <span style={BREAK_ANYWHERE}>{mimeType}</span>
        </InfoList.Row>
        <InfoList.Row title="Size">{formatFileSize(size)}</InfoList.Row>
        <InfoList.Row title="Last modified">
          {lastModified ? (
            <SmartDate show="dateTime" value={lastModified} />
          ) : (
            'Unknown'
          )}
        </InfoList.Row>
      </InfoList>
    </Canvas>
  );
}
