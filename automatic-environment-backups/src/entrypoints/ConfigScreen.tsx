import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import { Page } from 'datocms-react-ui/Page';
import Pill from 'datocms-react-ui/Pill';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AdvancedSettings } from '../config/AdvancedSettings';
import {
  deriveStepStatuses,
  type SetupStepId,
  type StepStatus,
} from '../config/deriveStepStatuses';
import { StatusOverview } from '../config/StatusOverview';
import { StepConnect } from '../config/StepConnect';
import { StepDeploy } from '../config/StepDeploy';
import { StepSchedule } from '../config/StepSchedule';
import { StepSecret } from '../config/StepSecret';
import { useBackupsConfig } from '../config/useBackupsConfig';

type CurrentFocus = {
  step: SetupStepId | null;
  status: StepStatus | null;
};

const STATUS_PILLS: Partial<Record<StepStatus, ReactNode>> = {
  ok: <Pill tone="success">Done</Pill>,
  error: <Pill tone="danger">Failed</Pill>,
};

/** Four-step setup wizard plus the operational backup status. */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const config = useBackupsConfig(ctx);
  const statuses = deriveStepStatuses(config.params);
  const { currentStep } = statuses;
  const currentStatus = currentStep ? statuses[currentStep] : null;

  // Automatically focus only the active step. The Set remains multi-open so a
  // user can reopen completed steps without collapsing the active one or
  // causing the scroll jump produced by a single-open accordion.
  const [openSteps, setOpenSteps] = useState<Set<SetupStepId>>(
    () => new Set(currentStep ? [currentStep] : []),
  );
  const previousFocusRef = useRef<CurrentFocus>({
    step: currentStep,
    status: currentStatus,
  });

  useEffect(() => {
    const previous = previousFocusRef.current;
    if (previous.step === currentStep && previous.status === currentStatus) {
      return;
    }

    previousFocusRef.current = { step: currentStep, status: currentStatus };
    setOpenSteps(new Set<SetupStepId>(currentStep ? [currentStep] : []));
  }, [currentStatus, currentStep]);

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

  // A step not reached yet stays closed: its chevron is disabled.
  const sectionOf = (step: SetupStepId) =>
    statuses[step] === 'disabled'
      ? {
          status: <Pill tooltip="Finish the steps above first.">Locked</Pill>,
          collapse: { open: false },
        }
      : {
          status: STATUS_PILLS[statuses[step]],
          collapse: {
            open: openSteps.has(step),
            onToggle: () => toggleStep(step),
          },
        };

  // The host gives the frame its width and its padding, and draws the
  // "Plugin settings" title above it: the introduction starts the frame, with
  // no Page around it, and each step is a section under it
  return (
    <Canvas ctx={ctx}>
      {!config.canEdit && (
        <Callout>Your role can view this setup but can't change it.</Callout>
      )}
      <Page.Section>
        <Page.SectionDescription>
          A service on Vercel, Netlify or Cloudflare runs the backups on a
          schedule. Set it up in four steps.
        </Page.SectionDescription>
      </Page.Section>
      <StepSecret config={config} section={sectionOf('secret')} />
      <StepDeploy config={config} section={sectionOf('deploy')} />
      <StepConnect config={config} section={sectionOf('connect')} />
      <StepSchedule
        config={config}
        section={sectionOf('schedule')}
        onFinish={() => setOpenSteps(new Set())}
      />
      <StatusOverview
        config={config}
        isConfiguredAndReady={currentStep === null}
      />
      <AdvancedSettings
        canEdit={config.canEdit}
        debugEnabled={config.debugEnabled}
        onToggleDebug={config.saveDebug}
      />
    </Canvas>
  );
}
