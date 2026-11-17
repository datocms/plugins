import {
  type AgentApprovalRequest,
  type AgentRuntimeConfig,
  type AgentTurnResult,
  createAgentRuntime,
} from '../../src/lib/agentRuntime';
import {
  installProviderTap,
  type ProviderCall,
  type RequestRewrite,
} from './providerTap';
import { assertUnderCap, recordCalls } from './spend';

export type TaskRun = {
  result: AgentTurnResult;
  /** Every unsafe call the model asked to run, in order. All were approved. */
  approvals: AgentApprovalRequest[];
  calls: ProviderCall[];
  usd: number;
  text: string;
};

export type RunTaskOptions = {
  label: string;
  config: Omit<AgentRuntimeConfig, 'context' | 'navigation'> & {
    provider: NonNullable<AgentRuntimeConfig['provider']>;
  };
  projectId: string;
  environment: string;
  message: string;
  rewrite?: RequestRewrite;
  /** Approval rounds before the run counts as stuck. */
  maxApprovalRounds?: number;
};

const acknowledge = () => ({ presented: true });

/**
 * Runs one chat request the way the inspector does, approving every unsafe
 * script the model proposes, until the turn ends. Usage goes to the spend ledger.
 */
export async function runTask(options: RunTaskOptions): Promise<TaskRun> {
  assertUnderCap(
    options.config.provider === 'anthropic' ? 'anthropic' : 'openai',
  );
  const tap = installProviderTap(options.rewrite);
  const approvals: AgentApprovalRequest[] = [];
  let text = '';
  try {
    // The SDKs bind fetch when the runtime builds them, so the tap goes in first.
    const runtime = createAgentRuntime({
      ...options.config,
      mcpAccessLevel: 'unrestricted',
      context: {
        siteId: options.projectId,
        environment: options.environment,
        isEnvironmentPrimary: false,
        siteName: 'claude-e2e-dato-agent',
        surface: 'project',
      },
      navigation: {
        openRecord: acknowledge,
        showRecords: acknowledge,
        presentRecords: acknowledge,
        presentAssets: acknowledge,
      },
    });
    let result = await runtime.runTurn({ message: options.message });
    text += result.text;
    for (
      let round = 0;
      result.status === 'approval_required' && result.responseId;
      round++
    ) {
      if (round >= (options.maxApprovalRounds ?? 20)) break;
      approvals.push(...result.approvals);
      result = await runtime.submitApprovals({
        responseId: result.responseId,
        decisions: result.approvals.map((approval) => ({
          approvalRequestId: approval.approvalRequestId,
          approve: true,
        })),
      });
      text += result.text;
    }
    await runtime.dispose?.();
    return { result, approvals, calls: tap.calls, usd: 0, text };
  } finally {
    await tap.restore();
  }
}

/** Records the run's provider calls in the ledger and fills in its cost. */
export function settle(run: TaskRun, label: string): TaskRun {
  return { ...run, usd: recordCalls(label, run.calls) };
}
