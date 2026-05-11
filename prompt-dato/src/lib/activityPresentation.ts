import {
  formatDuration,
  type ProcessEntry,
  type ProcessTrace,
  type ProcessTraceStatus,
} from './processTrace';

export type ActivityStepState =
  | 'current'
  | 'done'
  | 'error'
  | 'waiting'
  | 'stopped';

export type ActivityStep = {
  id: string;
  label: string;
  state: ActivityStepState;
  duration: string;
};

export type ActivityView = {
  title: string;
  statusText: string;
  currentStep: string;
  completedSteps: string[];
  visibleSteps: ActivityStep[];
  debugEntries: ProcessEntry[];
  stepCount: number;
  duration: string;
};

export type ActivitySummary = {
  title: string;
  statusText: string;
  currentStep: string;
  completedSteps: string[];
  stepCount: number;
  duration: string;
};

type StepCategory =
  | 'load-actions'
  | 'read-schema'
  | 'read-data'
  | 'apply-changes'
  | 'approval'
  | 'project-check'
  | 'writing'
  | 'error';

type ActivityGroup = {
  category: StepCategory;
  state: ActivityStepState;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  order: number;
};

export function buildActivityView(trace: ProcessTrace): ActivityView {
  const debugEntries = trace.entries;
  const groups = buildActivityGroups(trace);
  const activeGroup = findActiveGroup(groups, trace.status);
  const completedGroups = groups.filter((group) => group.state === 'done');
  const visibleGroups = pickVisibleGroups(groups, activeGroup, trace.status);
  const visibleSteps = visibleGroups.map((group) =>
    groupToStep(group, trace.status, activeGroup),
  );
  const fallbackStep = fallbackActivityStep(trace);
  const steps = visibleSteps.length > 0 ? visibleSteps : [fallbackStep];
  const currentStep = activeGroup
    ? labelForGroup(activeGroup, trace.status, activeGroup)
    : steps.at(-1)?.label ?? fallbackStep.label;

  return {
    title: trace.status === 'running' ? 'Working' : 'Activity',
    statusText: statusTextForTrace(trace.status),
    currentStep,
    completedSteps: completedGroups
      .slice(-2)
      .map((group) => labelForGroup(group, trace.status)),
    visibleSteps: steps,
    debugEntries,
    stepCount: Math.max(groups.length, 1),
    duration: formatDuration(trace.startedAt, trace.endedAt),
  };
}

export function buildActivitySteps(trace: ProcessTrace): ActivityStep[] {
  return buildActivityView(trace).visibleSteps;
}

export function buildActivitySummary(trace: ProcessTrace): ActivitySummary {
  const view = buildActivityView(trace);
  return {
    title: view.title,
    statusText: view.statusText,
    currentStep: view.currentStep,
    completedSteps: view.completedSteps,
    stepCount: view.stepCount,
    duration: view.duration,
  };
}

export function traceHasProjectActivity(trace: ProcessTrace): boolean {
  return trace.entries.some((entry) =>
    entry.kind === 'mcp_list' ||
    entry.kind === 'mcp_call' ||
    entry.kind === 'approval',
  );
}

function buildActivityGroups(trace: ProcessTrace): ActivityGroup[] {
  const groups = new Map<StepCategory, ActivityGroup>();

  for (const [index, entry] of trace.entries.entries()) {
    const category = categoryForEntry(entry);
    if (!category) continue;

    const incoming = groupFromEntry(entry, category, index);
    const existing = groups.get(category);
    groups.set(
      category,
      existing ? mergeGroup(existing, incoming) : incoming,
    );
  }

  if (shouldAddWritingStep(trace, groups)) {
    groups.set('writing', {
      category: 'writing',
      state: trace.status === 'running' ? 'current' : 'done',
      startedAt: trace.updatedAt,
      updatedAt: trace.updatedAt,
      ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
      order: trace.entries.length + 1,
    });
  }

  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function categoryForEntry(entry: ProcessEntry): StepCategory | null {
  if (entry.kind === 'reasoning') return null;
  if (entry.kind === 'mcp_list') return 'load-actions';
  if (entry.kind === 'approval') return 'approval';
  if (entry.kind === 'error') return 'error';

  if (entry.kind !== 'mcp_call') return null;

  if (entry.toolName === 'get_schema') return 'read-schema';
  if (entry.toolName === 'upsert_and_execute_safe_script') return 'read-data';
  if (entry.toolName === 'upsert_and_execute_unsafe_script') {
    return 'apply-changes';
  }

  return 'project-check';
}

function groupFromEntry(
  entry: ProcessEntry,
  category: StepCategory,
  order: number,
): ActivityGroup {
  return {
    category,
    state: stateForEntry(entry),
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    ...(entry.endedAt ? { endedAt: entry.endedAt } : {}),
    order,
  };
}

function mergeGroup(existing: ActivityGroup, incoming: ActivityGroup): ActivityGroup {
  const newerState = stateForMergedGroup(existing, incoming);

  return {
    category: existing.category,
    state: newerState,
    startedAt: Math.min(existing.startedAt, incoming.startedAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    ...(incoming.endedAt || existing.endedAt
      ? { endedAt: Math.max(incoming.endedAt ?? 0, existing.endedAt ?? 0) }
      : {}),
    order: Math.min(existing.order, incoming.order),
  };
}

function stateForMergedGroup(
  existing: ActivityGroup,
  incoming: ActivityGroup,
): ActivityStepState {
  if (incoming.updatedAt > existing.updatedAt) return incoming.state;
  if (incoming.updatedAt < existing.updatedAt) return existing.state;
  if (incoming.order > existing.order) return incoming.state;
  if (incoming.order < existing.order) return existing.state;

  const priority: Record<ActivityStepState, number> = {
    done: 0,
    stopped: 1,
    current: 2,
    waiting: 3,
    error: 4,
  };

  return priority[incoming.state] >= priority[existing.state]
    ? incoming.state
    : existing.state;
}

function pickVisibleGroups(
  groups: ActivityGroup[],
  activeGroup: ActivityGroup | undefined,
  status: ProcessTraceStatus,
): ActivityGroup[] {
  if (
    activeGroup &&
    (status === 'waiting' || status === 'failed' || status === 'interrupted')
  ) {
    return [activeGroup];
  }

  const byUpdatedAt = [...groups].sort((a, b) => a.updatedAt - b.updatedAt);

  if (activeGroup) {
    const completedBeforeActive = byUpdatedAt.filter(
      (group) =>
        group.category !== activeGroup.category &&
        group.state === 'done' &&
        group.updatedAt <= activeGroup.updatedAt,
    );
    return [...completedBeforeActive.slice(-2), activeGroup];
  }

  return byUpdatedAt.filter((group) => group.state === 'done').slice(-3);
}

function findActiveGroup(
  groups: ActivityGroup[],
  status: ProcessTraceStatus,
): ActivityGroup | undefined {
  if (status === 'completed') return undefined;

  const activeStates: ActivityStepState[] =
    status === 'failed'
      ? ['error']
      : status === 'waiting'
        ? ['waiting']
        : status === 'interrupted'
          ? ['stopped', 'error']
          : ['current', 'waiting', 'error', 'stopped'];

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group && activeStates.includes(group.state)) return group;
  }

  return undefined;
}

function shouldAddWritingStep(
  trace: ProcessTrace,
  groups: Map<StepCategory, ActivityGroup>,
): boolean {
  if (!trace.summary.includes('Writing response')) return false;
  if (groups.has('writing')) return false;

  const hasActive = [...groups.values()].some(
    (group) =>
      group.state === 'current' ||
      group.state === 'waiting' ||
      (isStoppedTrace(trace.status) &&
        (group.state === 'error' || group.state === 'stopped')),
  );

  return !hasActive;
}

function fallbackActivityStep(trace: ProcessTrace): ActivityStep {
  return {
    id: 'summary',
    label: labelForSummary(trace.summary),
    state: stateForTrace(trace.status),
    duration: formatDuration(trace.startedAt, trace.endedAt),
  };
}

function groupToStep(
  group: ActivityGroup,
  traceStatus: ProcessTraceStatus,
  activeGroup?: ActivityGroup,
): ActivityStep {
  return {
    id: group.category,
    label: labelForGroup(group, traceStatus, activeGroup),
    state: visualStateForGroup(group, traceStatus, activeGroup),
    duration: formatDuration(group.startedAt, group.endedAt),
  };
}

function labelForGroup(
  group: ActivityGroup,
  traceStatus: ProcessTraceStatus,
  activeGroup?: ActivityGroup,
): string {
  const state = visualStateForGroup(group, traceStatus, activeGroup);
  const running = state === 'current';
  const failed = state === 'error';
  const recovering =
    !isStoppedTrace(traceStatus) &&
    group.state === 'error' &&
    state !== 'error' &&
    activeGroup?.category === group.category;

  if (recovering) return 'Trying another approach';

  if (group.category === 'load-actions') {
    if (failed) return 'Could not load project actions';
    return running ? 'Loading project actions' : 'Loaded project actions';
  }

  if (group.category === 'read-schema') {
    if (failed) return 'Could not read project schema';
    return running ? 'Reading project schema' : 'Read project schema';
  }

  if (group.category === 'read-data') {
    if (failed) return 'Could not read project data';
    return running ? 'Reading project data' : 'Read project data';
  }

  if (group.category === 'apply-changes') {
    if (failed) return 'Could not apply project changes';
    return running ? 'Applying project changes' : 'Applied project changes';
  }

  if (group.category === 'approval') {
    if (group.state === 'waiting') return 'Waiting for approval';
    if (group.state === 'stopped') return 'Action denied';
    return 'Action approved';
  }

  if (group.category === 'writing') {
    return running ? 'Writing response' : 'Wrote response';
  }

  if (group.category === 'error') return 'Could not finish request';

  if (failed) return 'Could not check project data';
  return running ? 'Checking project data' : 'Checked project data';
}

function visualStateForGroup(
  group: ActivityGroup,
  traceStatus: ProcessTraceStatus,
  activeGroup?: ActivityGroup,
): ActivityStepState {
  if (group.state !== 'error' || traceStatus === 'failed') return group.state;
  if (traceStatus === 'interrupted') return 'stopped';
  if (traceStatus === 'running' && activeGroup?.category === group.category) {
    return 'current';
  }
  return 'done';
}

function isStoppedTrace(status: ProcessTraceStatus): boolean {
  return status === 'failed' || status === 'interrupted';
}

function stateForTrace(status: ProcessTraceStatus): ActivityStepState {
  if (status === 'running') return 'current';
  if (status === 'waiting') return 'waiting';
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'error';
  return 'stopped';
}

function stateForEntry(entry: ProcessEntry): ActivityStepState {
  if (entry.status === 'running') return 'current';
  if (entry.status === 'pending') return 'waiting';
  if (entry.status === 'failed') return 'error';
  if (entry.status === 'interrupted' || entry.status === 'denied') {
    return 'stopped';
  }
  return 'done';
}

function statusTextForTrace(status: ProcessTraceStatus): string {
  if (status === 'running') return 'Running';
  if (status === 'waiting') return 'Waiting';
  if (status === 'completed') return 'Done';
  return 'Stopped';
}

function labelForSummary(summary: string): string {
  if (!summary.trim()) return 'Preparing response';
  if (summary.includes('Approval needed')) return 'Waiting for approval';
  if (summary.includes('Writing response')) return 'Writing response';
  if (summary.includes('Preparing response')) return 'Preparing response';
  if (summary.includes('Request failed')) return 'Could not finish request';
  if (summary.includes('Completed')) return 'Completed';
  if (summary.includes('Continuing work')) return 'Continuing work';
  if (summary.includes('schema')) return 'Reading project schema';
  if (summary.includes('DatoCMS action')) return 'Checking project data';
  return summary;
}
