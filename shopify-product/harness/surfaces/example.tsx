import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import Button from 'datocms-react-ui/Button';
import Canvas from 'datocms-react-ui/Canvas';
import type { CSSProperties } from 'react';
import { StarIcon, TrashIcon, XmarkIcon } from '../../src/icons';
import { getPath } from '../mockCtx';
import { defineSurface } from '../surface';
import { EXAMPLE_MODAL_ID } from './example-modal';

/**
 * Proves the harness end to end without the real entrypoints: a small field
 * editor built from the kit's Button and the plugin's icons that reads and writes
 * `ctx.formValues`, opens the example modal, asks for a confirm and shows a
 * notice. The swatches show the resolved tokens in the current scheme.
 */

const SWATCHES = [
  '--color--surface',
  '--color--surface-raised',
  '--color--ink',
  '--color--ink-subtle',
  '--color--primary--surface',
  '--color--border',
];

const styles = {
  stack: { display: 'flex', flexDirection: 'column', gap: 12 },
  value: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    border: '1px solid var(--color--border)',
    borderRadius: 4,
    background: 'var(--color--surface-raised)',
  },
  empty: { color: 'var(--color--ink-subtle)' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  swatches: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 16px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color--ink-subtle)',
  },
  swatch: { display: 'flex', alignItems: 'center', gap: 6 },
  chip: {
    width: 14,
    height: 14,
    border: '1px solid var(--color--border)',
    borderRadius: 4,
  },
} satisfies Record<string, CSSProperties>;

function ExampleField({ ctx }: { ctx: RenderFieldExtensionCtx }) {
  const stored = getPath(ctx.formValues, ctx.fieldPath);
  const current = typeof stored === 'string' ? stored : null;

  const pick = async () => {
    const result = await ctx.openModal({
      id: EXAMPLE_MODAL_ID,
      title: 'Pick an option',
      width: 's',
      parameters: { current },
    });
    if (typeof result === 'string') {
      await ctx.setFieldValue(ctx.fieldPath, result);
    }
  };

  const clear = async () => {
    const confirmed = await ctx.openConfirm({
      title: 'Clear the value?',
      content: 'The example field goes back to empty.',
      choices: [{ label: 'Clear', value: true, intent: 'negative' }],
      cancel: { label: 'Cancel', value: false },
    });
    if (confirmed === true) {
      await ctx.setFieldValue(ctx.fieldPath, null);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div style={styles.stack}>
        <div style={styles.value}>
          <StarIcon />
          {current ? (
            <span>{current}</span>
          ) : (
            <span style={styles.empty}>Nothing selected</span>
          )}
        </div>
        <div style={styles.actions}>
          <Button
            tone="primary"
            icon={StarIcon}
            label="Pick an option"
            onClick={pick}
            disabled={ctx.disabled}
          />
          <Button
            icon={TrashIcon}
            label="Clear"
            onClick={clear}
            disabled={ctx.disabled || current === null}
          />
          <Button
            icon={XmarkIcon}
            label="Show a notice"
            onClick={() => ctx.notice('Hello from the harness')}
          />
        </div>
        <ul style={styles.swatches}>
          {SWATCHES.map((token) => (
            <li key={token} style={styles.swatch}>
              <span style={{ ...styles.chip, background: `var(${token})` }} />
              <code>{token}</code>
            </li>
          ))}
        </ul>
      </div>
    </Canvas>
  );
}

export default defineSurface({
  id: 'example',
  title: 'Example: field editor',
  kind: 'field',
  description:
    "Harness self-test: the kit's Canvas and Button with the plugin's icons, and mock setFieldValue, openModal, openConfirm and notice.",
  states: {
    empty: { description: 'No value yet.' },
    'with-value': { value: 'Option B', description: 'A stored string.' },
    disabled: {
      value: 'Option A',
      disabled: true,
      description: 'ctx.disabled: read-only.',
    },
    'in-block': {
      value: 'Option C',
      background: 'raised',
      description: 'On surface-raised, as inside a modular block.',
    },
  },
  render: (ctx) => <ExampleField ctx={ctx()} />,
});
