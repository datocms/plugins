import { faSquareCheck } from '@fortawesome/free-regular-svg-icons';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import type { CSSProperties } from 'react';
import { Button } from '../../src/ui/Button';
import { Icon } from '../../src/ui/Icon';
import { defineSurface } from '../surface';

/**
 * The modal the example field opens. It proves the modal round trip: the host
 * opens this surface in a second frame with the caller's parameters, and
 * `ctx.resolve` settles the field frame's `ctx.openModal` promise.
 */

export const EXAMPLE_MODAL_ID = 'harnessExampleModal';

const OPTIONS = ['Option A', 'Option B', 'Option C'];

const styles = {
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  footer: { display: 'flex', justifyContent: 'flex-end', marginTop: 24 },
} satisfies Record<string, CSSProperties>;

function ExampleModal({ ctx }: { ctx: RenderModalCtx }) {
  const current =
    typeof ctx.parameters.current === 'string' ? ctx.parameters.current : null;

  return (
    <Canvas ctx={ctx}>
      <div style={styles.list}>
        {OPTIONS.map((option) => (
          <Button
            key={option}
            fullWidth
            buttonType={option === current ? 'primary' : 'muted'}
            leftIcon={
              option === current ? <Icon icon={faSquareCheck} /> : undefined
            }
            onClick={() => ctx.resolve(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      <div style={styles.footer}>
        <Button buttonSize="s" onClick={() => ctx.resolve(null)}>
          Cancel
        </Button>
      </div>
    </Canvas>
  );
}

export default defineSurface({
  id: EXAMPLE_MODAL_ID,
  title: 'Example: modal',
  kind: 'modal',
  description: 'Harness self-test for renderModal.',
  states: {
    default: {
      modalWidth: 's',
      modalTitle: 'Pick an option',
      modalParameters: { current: 'Option B' },
    },
  },
  render: (ctx) => <ExampleModal ctx={ctx()} />,
});
