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
import { StepTimeline } from '../config/StepTimeline';
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

  // Multi-open accordion: track an open-step Set instead of a single expanded
  // step. Toggling one step is purely additive and never collapses another, so
  // clicking [Edit] on a lower step can't shift a higher one out from under the
  // viewport (the old single-`expandedStep` model caused that scroll-jump CLS).
  // We deliberately keep the custom StepSection (numbered card + status badge)
  // rather than the SDK collapsible Section; the multi-open model is the fix.
  const [openSteps, setOpenSteps] = useState<Set<SetupStepId>>(
    () => new Set(currentStep ? [currentStep] : []),
  );
  const previousCurrentStepRef = useRef(currentStep);
  useEffect(() => {
    const previous = previousCurrentStepRef.current;
    if (previous === currentStep) {
      return;
    }
    previousCurrentStepRef.current = currentStep;

    // Right after the secret is saved (secret → connect) with nothing deployed
    // yet, keep step 1's deploy callout visible AND reveal step 2 so the user
    // can paste their deployed URL without losing the deploy menu.
    const justSavedSecretBeforeDeploy =
      previous === 'secret' && currentStep === 'connect' && !config.savedUrl;
    if (justSavedSecretBeforeDeploy) {
      setOpenSteps(new Set<SetupStepId>(['secret', 'connect']));
      return;
    }

    // On any other current-step change, focus the accordion on the new step.
    setOpenSteps(new Set<SetupStepId>(currentStep ? [currentStep] : []));
  }, [currentStep, config.savedUrl]);

  const toggleStep = (step: SetupStepId) =>
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });

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
        <StepTimeline statuses={statuses} />

        <StepSection
          stepNumber={1}
          title="Auth secret & deploy"
          description="Create a shared secret the plugin and your deployed function use to authenticate, then deploy the scheduler."
          status={statuses.secret}
          isExpanded={openSteps.has('secret')}
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
          isExpanded={openSteps.has('connect')}
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
          isExpanded={openSteps.has('schedule')}
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
