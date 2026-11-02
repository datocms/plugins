import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import type { ReactNode } from 'react';
import styles from './FieldSettings.module.css';

/**
 * The `container` of a field whose warning follows its hint. The warning sits
 * inside the field, so the input stays mounted (and keeps its focus) when it
 * appears.
 */
export function fieldNotice(
  notice: string | null,
): { trailing: ReactNode } | undefined {
  if (!notice) return undefined;
  return {
    trailing: (
      <Callout tone="warning" className={styles.fieldNotice}>
        {notice}
      </Callout>
    ),
  };
}

type CalloutWithActionProps = {
  tone: 'neutral' | 'warning' | 'danger';
  title?: string;
  /** The action that fixes it: right under the callout, never inside it. */
  action?: { label: string; onClick: () => void };
  children: ReactNode;
};

/** A message about the current data, with the button that acts on it under it. */
export function CalloutWithAction({
  tone,
  title,
  action,
  children,
}: CalloutWithActionProps) {
  return (
    <>
      <Callout
        tone={tone}
        title={title}
        className={action ? styles.calloutWithAction : undefined}
      >
        {children}
      </Callout>
      {action && (
        <div className={styles.action}>
          <Button label={action.label} onClick={action.onClick} />
        </div>
      )}
    </>
  );
}
