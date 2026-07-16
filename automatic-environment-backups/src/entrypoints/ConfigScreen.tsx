import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useEffect, useRef, useState } from 'react';
import { AdvancedSettings } from '../config/AdvancedSettings';
import {
  deriveStepStatuses,
  type SetupStepId,
  type StepStatus,
} from '../config/deriveStepStatuses';
import { InstallationSection } from '../config/InstallationSection';
import { readEnabledCadences } from '../config/pluginParams';
import { StatusBox } from '../config/StatusBox';
import { StatusOverview } from '../config/StatusOverview';
import { StepConnect } from '../config/StepConnect';
import { StepDeploy } from '../config/StepDeploy';
import { StepSchedule } from '../config/StepSchedule';
import { StepSecret } from '../config/StepSecret';
import { StepSection } from '../config/StepSection';
import { StepTimeline } from '../config/StepTimeline';
import { useBackupsConfig } from '../config/useBackupsConfig';
import { getCadenceLabel } from '../utils/backupSchedule';
import styles from './ConfigScreen.module.css';

type CurrentFocus = {
  step: SetupStepId | null;
  status: StepStatus | null;
};

/** Four-step setup wizard plus the operational backup status. */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const config = useBackupsConfig(ctx);
  const { params } = config;
  const statuses = deriveStepStatuses(params);
  const { currentStep } = statuses;
  const currentStatus = currentStep ? statuses[currentStep] : null;
  const isSetupComplete = currentStep === null;

  // Automatically focus only the active step. The Set remains multi-open so a
  // user can reopen completed steps without collapsing the active one or
  // causing the scroll jump produced by a single-open accordion.
  const [openSteps, setOpenSteps] = useState<Set<SetupStepId>>(
    () => new Set(currentStep ? [currentStep] : []),
  );
  const [isInstallationExpanded, setIsInstallationExpanded] = useState(false);
  const previousFocusRef = useRef<CurrentFocus>({
    step: currentStep,
    status: currentStatus,
  });
  const previousSetupCompleteRef = useRef(isSetupComplete);

  useEffect(() => {
    const previous = previousFocusRef.current;
    if (previous.step === currentStep && previous.status === currentStatus) {
      return;
    }

    previousFocusRef.current = { step: currentStep, status: currentStatus };
    setOpenSteps(new Set<SetupStepId>(currentStep ? [currentStep] : []));
  }, [currentStatus, currentStep]);

  useEffect(() => {
    const wasSetupComplete = previousSetupCompleteRef.current;
    previousSetupCompleteRef.current = isSetupComplete;

    if (!wasSetupComplete && isSetupComplete) {
      setIsInstallationExpanded(false);
    }
  }, [isSetupComplete]);

  const toggleStep = (step: SetupStepId) => {
    setOpenSteps((previous) => {
      const next = new Set(previous);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  const enabledCadences = readEnabledCadences(params);
  const scheduleSummary = enabledCadences.map(getCadenceLabel).join(', ');

  const setupFlow = (
    <>
      {!config.canEdit && (
        <StatusBox
          variant="neutral"
          style={{ marginBottom: 'var(--spacing-l)' }}
        >
          You can review this setup, but your role cannot change plugin
          settings.
        </StatusBox>
      )}

      <StepTimeline statuses={statuses} />

      <StepSection
        stepNumber={1}
        title="Create a secret"
        description="Generate the shared secret used by this plugin and the backup service."
        status={statuses.secret}
        isExpanded={openSteps.has('secret')}
        onToggle={() => toggleStep('secret')}
        summary="Secret saved."
      >
        <StepSecret config={config} />
      </StepSection>

      <StepSection
        stepNumber={2}
        title="Deploy the backup service"
        description="Add the required environment variables, deploy the service, and save its public URL."
        status={statuses.deploy}
        isExpanded={openSteps.has('deploy')}
        onToggle={() => toggleStep('deploy')}
        summary={config.savedUrl || 'Deployment URL saved.'}
      >
        <StepDeploy config={config} />
      </StepSection>

      <StepSection
        stepNumber={3}
        title="Test the connection"
        description="Verify that the deployed service is reachable and uses the same shared secret."
        status={statuses.connect}
        isExpanded={openSteps.has('connect')}
        onToggle={() => toggleStep('connect')}
        summary="Connection verified."
      >
        <StepConnect config={config} />
      </StepSection>

      <StepSection
        stepNumber={4}
        title="Choose a backup schedule"
        description="Select which automatic backup environments the service should maintain."
        status={statuses.schedule}
        isExpanded={openSteps.has('schedule')}
        onToggle={() => toggleStep('schedule')}
        summary={scheduleSummary}
      >
        <StepSchedule
          config={config}
          onFinish={() => setIsInstallationExpanded(false)}
        />
      </StepSection>
    </>
  );

  return (
    <Canvas ctx={ctx}>
      <main className={styles.wrapper}>
        {isSetupComplete ? (
          <InstallationSection
            isOpen={isInstallationExpanded}
            onOpenChange={setIsInstallationExpanded}
          >
            {setupFlow}
          </InstallationSection>
        ) : (
          setupFlow
        )}

        <StatusOverview
          config={config}
          isConfiguredAndReady={isSetupComplete}
        />

        <AdvancedSettings
          canEdit={config.canEdit}
          debugEnabled={config.debugEnabled}
          onToggleDebug={config.saveDebug}
        />
      </main>
    </Canvas>
  );
}
