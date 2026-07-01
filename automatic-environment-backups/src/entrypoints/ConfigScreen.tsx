import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useEffect, useRef, useState } from 'react';
import { AdvancedSettings } from '../config/AdvancedSettings';
import {
  deriveStepStatuses,
  type SetupStepId,
} from '../config/deriveStepStatuses';
import { readEnabledCadences } from '../config/pluginParams';
import { StatusOverview } from '../config/StatusOverview';
import { StepConnect } from '../config/StepConnect';
import { StepSchedule } from '../config/StepSchedule';
import { StepSection } from '../config/StepSection';
import { StepSecret } from '../config/StepSecret';
import { useBackupsConfig } from '../config/useBackupsConfig';
import { getCadenceLabel } from '../utils/backupSchedule';

/**
 * Thin orchestrator for the config wizard. Reads the saved plugin parameters as
 * the single source of truth, derives per-step statuses, and renders the gated
 * accordion (steps 1–3) plus the always-visible Status overview and Advanced
 * settings. All state and side effects live in {@link useBackupsConfig}; there
 * is no global Save button — each step commits its own change.
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const config = useBackupsConfig(ctx);
  const { params } = config;
  const statuses = deriveStepStatuses(params);
  const { currentStep } = statuses;

  // The current/error step auto-expands; users can [Edit] an `ok` step to
  // override. Syncing to `currentStep` (tracked via a ref) follows the wizard
  // as saves advance it, without clobbering manual edits.
  const [expandedStep, setExpandedStep] = useState<SetupStepId | null>(
    currentStep,
  );
  const previousCurrentStepRef = useRef(currentStep);
  useEffect(() => {
    const previous = previousCurrentStepRef.current;
    if (previous === currentStep) {
      return;
    }
    previousCurrentStepRef.current = currentStep;

    // Right after the secret is saved (secret → connect) with nothing deployed
    // yet, keep step 1 expanded so its deploy menu + paste callout stay visible;
    // the user advances to step 2 when they have a deployed URL in hand.
    const justSavedSecretBeforeDeploy =
      previous === 'secret' && currentStep === 'connect' && !config.savedUrl;
    if (justSavedSecretBeforeDeploy) {
      return;
    }

    setExpandedStep(currentStep);
  }, [currentStep, config.savedUrl]);

  const toggleStep = (step: SetupStepId) =>
    setExpandedStep((current) => (current === step ? null : step));

  const enabledCadences = readEnabledCadences(params);
  const secretSummary = 'Secret saved.';
  const connectSummary = config.savedUrl
    ? `Connected to ${config.savedUrl}`
    : 'Connected.';
  const scheduleSummary = `Backups: ${enabledCadences
    .map(getCadenceLabel)
    .join(', ')}`;

  return (
    <Canvas ctx={ctx}>
      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <StepSection
          stepNumber={1}
          title="Auth secret & deploy"
          description="Create a shared secret the plugin and your deployed function use to authenticate, then deploy the scheduler."
          status={statuses.secret}
          isExpanded={expandedStep === 'secret'}
          onToggle={() => toggleStep('secret')}
          summary={secretSummary}
        >
          <StepSecret config={config} />
        </StepSection>

        <StepSection
          stepNumber={2}
          title="Connect & test"
          description="Tell the plugin where your function is deployed and verify it responds and authenticates."
          status={statuses.connect}
          isExpanded={expandedStep === 'connect'}
          onToggle={() => toggleStep('connect')}
          summary={connectSummary}
        >
          <StepConnect config={config} />
        </StepSection>

        <StepSection
          stepNumber={3}
          title="Backup cadence"
          description="Choose how often backups run. The scheduler runs once daily and creates the sandbox backups you enable."
          status={statuses.schedule}
          isExpanded={expandedStep === 'schedule'}
          onToggle={() => toggleStep('schedule')}
          summary={scheduleSummary}
        >
          <StepSchedule config={config} />
        </StepSection>

        <StatusOverview
          config={config}
          isConfiguredAndReady={currentStep === null}
        />

        <AdvancedSettings
          debugEnabled={config.debugEnabled}
          onToggleDebug={config.saveDebug}
        />
      </div>
    </Canvas>
  );
}
