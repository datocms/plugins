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

// A filename with no spaces breaks anywhere, so it stays in its row
const BREAK_ANYWHERE: CSSProperties = { overflowWrap: 'anywhere' };

function stringParameter(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function nonNegativeNumberParameter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function formatFileSize(size: number): string {
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
  const size = nonNegativeNumberParameter(ctx.parameters.size);
  const lastModified = lastModifiedDate(
    nonNegativeNumberParameter(ctx.parameters.lastModified),
  );
  const bytesAvailable = ctx.parameters.bytesAvailable === true;

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      {/* A file that is gone is a problem; one still on this page isn't */}
      <Callout tone={bytesAvailable ? 'neutral' : 'warning'}>
        {bytesAvailable
          ? 'The agent can read this file while this page is open, but it isn’t saved in the Media Area.'
          : 'This file is no longer available: attach it again if the agent needs it.'}
      </Callout>
      <InfoList>
        <InfoList.Row title="Filename">
          <span style={BREAK_ANYWHERE}>{filename}</span>
        </InfoList.Row>
        {/* An unknown fact tells nothing: its row stays out */}
        {size !== undefined && (
          <InfoList.Row title="Size">{formatFileSize(size)}</InfoList.Row>
        )}
        {lastModified && (
          <InfoList.Row title="Last modified">
            <SmartDate show="dateTime" value={lastModified} />
          </InfoList.Row>
        )}
      </InfoList>
    </Canvas>
  );
}
