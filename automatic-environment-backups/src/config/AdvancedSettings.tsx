import { Form, Section, SwitchField } from 'datocms-react-ui';
import { type CSSProperties, useState } from 'react';

const switchNoHintGapStyle = {
  '--spacing-s': '0',
  marginBottom: '0.25rem',
} as CSSProperties;

/**
 * Collapsible advanced settings. The debug toggle persists immediately on
 * change (consistent with the per-step save model — no global Save button).
 */
export const AdvancedSettings = ({
  debugEnabled,
  onToggleDebug,
}: {
  debugEnabled: boolean;
  onToggleDebug: (enabled: boolean) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Form>
      <Section
        title="Advanced settings"
        collapsible={{
          isOpen,
          onToggle: () => setIsOpen((current) => !current),
        }}
      >
        <div style={switchNoHintGapStyle}>
          <SwitchField
            name="debug"
            id="debug"
            label="Enable debug logs"
            hint="When enabled, plugin events and requests are logged to the browser console."
            value={debugEnabled}
            onChange={onToggleDebug}
          />
        </div>
        <p
          style={{
            margin: 0,
            color: 'var(--color--ink-subtle)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          This plugin runs in Lambda cron mode only.
        </p>
      </Section>
    </Form>
  );
};
