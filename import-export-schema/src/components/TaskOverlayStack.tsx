import {
  TaskProgressOverlay,
  type TaskProgressOverlayProps,
} from '@/components/TaskProgressOverlay';

// Small wrapper that lets import/export flows list every long-running task overlay they
// need (single export, mass export, import) without repeating overlay wiring at each call.

type OverlayConfig = TaskProgressOverlayProps & { id?: string | number };

type Props = {
  items: OverlayConfig[];
};

/**
 * Render a list of long-task overlays while keeping individual config definitions concise.
 * Centralizes the overlay stack so the entrypoints simply hand us the configs for any
 * concurrent export/import tasks instead of juggling multiple `<TaskProgressOverlay />`s.
 */
export function TaskOverlayStack({ items }: Props) {
  return (
    <>
      {items.map(({ id, ...config }, index) => (
        <TaskProgressOverlay key={id ?? index} {...config} />
      ))}
    </>
  );
}
