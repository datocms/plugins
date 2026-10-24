import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { Page } from 'datocms-react-ui/Page';
import SwitchInput from 'datocms-react-ui/SwitchInput';
import { useState } from 'react';

/**
 * Collapsible advanced settings. The debug toggle persists immediately on
 * change (consistent with the per-step save model: no global Save button).
 */
export const AdvancedSettings = ({
  canEdit,
  debugEnabled,
  onToggleDebug,
}: {
  canEdit: boolean;
  debugEnabled: boolean;
  onToggleDebug: (enabled: boolean) => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Page.Group
      title="Advanced settings"
      collapse={{ open, onToggle: () => setOpen(!open) }}
    >
      <FieldWrapper hint="Logs plugin events and requests to the browser console.">
        <SwitchInput
          label="Debug logs"
          value={debugEnabled}
          onChange={(value) => {
            void onToggleDebug(Boolean(value));
          }}
          disabled={!canEdit}
        />
      </FieldWrapper>
    </Page.Group>
  );
};
