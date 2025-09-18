import {
  TaskProgressOverlay,
  type TaskProgressOverlayProps,
} from '@/components/TaskProgressOverlay';

type OverlayConfig = TaskProgressOverlayProps & { id?: string | number };

type Props = {
  items: OverlayConfig[];
};

/**
 * Render a list of long-task overlays while keeping individual config definitions concise.
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
