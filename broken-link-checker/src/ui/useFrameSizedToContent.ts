import { useLayoutEffect } from 'react';

/**
 * Lets a frame that sizes itself to its content (the record panel, the scope
 * dialog, the config screen) shrink again.
 *
 * The kit's styles.css gives html and body `height: 100%`, which the project
 * page needs to fill its frame. The SDK's auto-resizer measures the body and
 * html, so with that rule the measure never drops below the current frame
 * height: a frame could grow when a list opens but never shrink when it
 * closes. Here html and body take their content's height again while the
 * frame is mounted. A layout effect runs before the Canvas starts the
 * auto-resizer, so the first measure is already the content's.
 */
export function useFrameSizedToContent() {
  useLayoutEffect(() => {
    const boxes = [document.documentElement, document.body];
    const previous = boxes.map((box) => box.style.height);
    for (const box of boxes) box.style.height = 'auto';
    return () => {
      for (const [index, box] of boxes.entries())
        box.style.height = previous[index];
    };
  }, []);
}
