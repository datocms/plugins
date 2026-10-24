import type { ReactNode } from 'react';
import s from './InlineCode.module.css';

/**
 * Code inside a line of text: the inline code of a reply, the name of an
 * action to approve
 */
export function InlineCode({ children }: { children?: ReactNode }) {
  return <code className={s.code}>{children}</code>;
}
