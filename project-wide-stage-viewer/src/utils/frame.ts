import { useLayoutEffect } from 'react';

/**
 * Lets a frame that sizes itself to its content (the config screen, the stage
 * picker modal) shrink again.
 *
 * The kit's styles.css gives html and body `height: 100%`, which a page frame
 * needs to fill its frame. The SDK's auto-resizer measures the body and html,
 * so with that rule the measure never drops below the current frame height:
 * the frame could grow when a menu opens or a row is added, but never shrink
 * when the menu closes or the row goes. Here html and body take their
 * content's height again while the frame is mounted.
 */
export function useFrameSizedToContent() {
  useLayoutEffect(() => {
    const boxes = [document.documentElement, document.body];
    const previous = boxes.map((box) => box.style.height);
    for (const box of boxes) {
      box.style.height = 'auto';
    }
    return () => {
      for (const [index, box] of boxes.entries()) {
        box.style.height = previous[index] ?? '';
      }
    };
  }, []);
}
