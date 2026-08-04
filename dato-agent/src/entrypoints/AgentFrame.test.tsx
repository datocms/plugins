import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSurfaceProps } from '../components/AgentSurface';
import type {
  AgentRuntime,
  AgentRuntimeConfig,
  AgentRuntimeEvent,
  AgentTurnArgs,
  AgentTurnResult,
  ContinueApprovalsArgs,
} from '../lib/agentRuntime';
import { createAutoApprovalStore } from '../lib/autoApproval';
import { type AgentProvider, DEFAULT_CONFIG } from '../lib/config';
import {
  type Conversation,
  createConversationStore,
} from '../lib/conversations';
import {
  createCredentialStore,
  createOAuthCredentials,
} from '../lib/credentials';
import { clearSessionLocalFiles, registerLocalFile } from '../lib/localFiles';
import type { AgentMentionHost } from '../lib/mentionHost';
import type {
  AgentComposerSubmission,
  LocalFileMention,
} from '../lib/mentions';
import { createUnsafeDispatchJournalStore } from '../lib/unsafeDispatchJournal';
import AgentFrame, { type AgentFrameProps } from './AgentFrame';

const mocks = vi.hoisted(() => ({
  surfaceProps: undefined as AgentSurfaceProps | undefined,
  runtime: undefined as AgentRuntime | undefined,
  runtimeConfig: undefined as AgentRuntimeConfig | undefined,
  runtimeConfigs: [] as AgentRuntimeConfig[],
}));
let testUser = 0;

vi.mock('../components/AgentSurface', () => ({
  AgentSurface: (props: AgentSurfaceProps) => {
    mocks.surfaceProps = props;
    return <div data-testid="agent-surface" />;
  },
}));

vi.mock('../lib/agentRuntime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/agentRuntime')>();
  return {
    ...original,
    createAgentRuntime: (config: AgentRuntimeConfig) => {
      mocks.runtimeConfig = config;
      mocks.runtimeConfigs.push(config);
      if (!mocks.runtime) {
        throw new Error('Test runtime was not configured.');
      }
      return mocks.runtime;
    },
  };
});

function completedResult(
  overrides: Partial<AgentTurnResult> = {},
): AgentTurnResult {
  return {
    status: 'completed',
    responseId: 'resp_complete',
    text: '',
    approvals: [],
    continuationCount: 0,
    ...overrides,
  };
}

function props(overrides: Partial<AgentFrameProps> = {}): AgentFrameProps {
  return {
    pluginId: 'plugin',
    siteId: 'site',
    siteName: 'Marketing site',
    environment: 'primary',
    isEnvironmentPrimary: true,
    currentUserId: `user-${testUser}`,
    scope: { type: 'project' },
    navigator: {
      supportsRecordList: true,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    },
    config: {
      ...DEFAULT_CONFIG,
      openAiApiKey: 'sk-test-key',
    },
    onReviewApprovalDetails: vi.fn(),
    onConfirmEnableAutoApprove: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function configForProvider(provider: AgentProvider) {
  return provider === 'anthropic'
    ? {
        ...DEFAULT_CONFIG,
        provider,
        anthropicApiKey: 'sk-ant-test-key',
        anthropicModel: 'claude-sonnet-test',
      }
    : {
        ...DEFAULT_CONFIG,
        provider,
        openAiApiKey: 'sk-test-key',
      };
}

function seedDatoConnection(
  frameProps: AgentFrameProps,
  accessToken = 'oauth-test-token',
): void {
  createCredentialStore({
    siteId: frameProps.siteId,
    currentUserId: frameProps.currentUserId,
  }).save(
    createOAuthCredentials(
      {
        clientId: 'test-client',
        clientIdIssuedAt: 1_700_000_000,
        redirectUri: 'https://example.test/oauth/callback',
      },
      {
        accessToken,
        tokenType: 'Bearer',
        obtainedAt: 1_700_000_000,
      },
    ),
    { remember: true },
  );
}

function enableAutoApproval(frameProps: AgentFrameProps): void {
  createAutoApprovalStore({
    pluginId: frameProps.pluginId,
    siteId: frameProps.siteId,
    environment: frameProps.environment,
    currentUserId: frameProps.currentUserId,
  }).setEnabled(true);
}

function localFileSubmission(
  mention: LocalFileMention,
  text = `Read ${mention.filename}`,
): AgentComposerSubmission {
  const { id, filename, mimeType, size, lastModified } = mention;
  return {
    displayText: text,
    providerText: text,
    segments: [
      { type: 'text', content: `${text} ` },
      { type: 'mention', mention },
    ],
    attachments: [{ id, filename, mimeType, size, lastModified }],
  };
}

function createdAssetMention(id: string, filename: string) {
  return {
    type: 'asset' as const,
    id,
    filename,
    url: `https://www.datocms-assets.com/${filename}`,
    thumbnailUrl: null,
    mimeType: filename.endsWith('.pdf') ? 'application/pdf' : 'image/png',
  };
}

function assetCreatingMentionHost(
  overrides: Partial<AgentMentionHost> = {},
): AgentMentionHost {
  return {
    currentUser: {
      id: 'editor',
      name: 'Editor',
      email: 'editor@example.com',
      avatarUrl: null,
      userType: 'user',
    },
    projectOwnerId: 'owner',
    projectModels: [],
    recordModels: [],
    canMentionFields: false,
    canMentionAssets: true,
    canMentionModels: false,
    canCreateAssets: true,
    loadProjectUsers: async () => [],
    selectAsset: async () => undefined,
    selectRecord: async () => undefined,
    resolveAsset: vi.fn(async ({ uploadId, label }) =>
      createdAssetMention(uploadId, label ?? `Asset-${uploadId}.png`),
    ),
    resolveRecord: vi.fn(async ({ itemId, label }) => ({
      type: 'record' as const,
      id: itemId,
      title: label ?? `Record #${itemId}`,
      modelId: 'unknown',
      modelApiKey: '',
      modelName: 'Record',
      modelEmoji: null,
      thumbnailUrl: null,
    })),
    createAsset: vi.fn(async (input) =>
      createdAssetMention(
        `created-${input.source}`,
        input.filename ?? (input.source === 'url' ? 'download.png' : 'file'),
      ),
    ),
    openUser: () => undefined,
    openModel: () => undefined,
    openLocalFile: async () => undefined,
    ...overrides,
  };
}

function storedConversation({
  id,
  title,
  updatedAt,
  previousResponseId,
  responseProvider,
  responseModel,
  hostContextFingerprint,
}: {
  id: string;
  title: string;
  updatedAt: string;
  previousResponseId?: string;
  responseProvider?: Conversation['responseProvider'];
  responseModel?: string;
  hostContextFingerprint?: string;
}): Conversation {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    ...(previousResponseId ? { previousResponseId } : {}),
    ...(responseProvider ? { responseProvider } : {}),
    ...(responseModel ? { responseModel } : {}),
    ...(hostContextFingerprint ? { hostContextFingerprint } : {}),
    messages: [
      {
        id: `message-${id}`,
        role: 'user',
        text: title,
        createdAt: updatedAt,
      },
    ],
  };
}

const unsafeApproval = {
  approvalRequestId: 'approval_1',
  name: 'upsert_and_execute_unsafe_script',
  serverLabel: 'datocms',
  arguments: JSON.stringify({
    site_id: 'site',
    name: 'script://dato-agent/site/primary/update-title.ts',
    body: {
      mode: 'full',
      content: 'await client.items.update("item", { title: "New" });',
    },
    method_tokens: ['token'],
  }),
  parsedArguments: {
    site_id: 'site',
    name: 'script://dato-agent/site/primary/update-title.ts',
  },
};

function unsafeApprovalWithId(id: string) {
  const scriptName = `script://dato-agent/site/primary/${id}.ts`;
  return {
    ...unsafeApproval,
    approvalRequestId: id,
    arguments: JSON.stringify({
      site_id: 'site',
      name: scriptName,
      body: {
        mode: 'full',
        content: `await client.items.update("${id}", { title: "New" });`,
      },
      method_tokens: ['token'],
    }),
    parsedArguments: {
      site_id: 'site',
      name: scriptName,
    },
  };
}

async function startApprovalTurn({
  withRecordReceipt = false,
}: {
  withRecordReceipt?: boolean;
} = {}): Promise<void> {
  const result = completedResult({
    status: 'approval_required',
    responseId: 'resp_approval',
    approvals: [unsafeApproval],
  });
  mocks.runtime = {
    runTurn: vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        if (withRecordReceipt) {
          await mocks.runtimeConfig?.navigation.presentRecords({
            title: 'Related record',
            records: [{ itemId: 'record-1', label: 'Related record' }],
          });
        }
        await onEvent?.({
          type: 'activity',
          responseId: 'resp_approval',
          activity: {
            id: 'approval_1',
            kind: 'mcp_tool',
            status: 'waiting',
            label: 'Preparing a CMS change',
          },
        });
        await onEvent?.({
          type: 'approval_required',
          responseId: 'resp_approval',
          approval: unsafeApproval,
        });
        await onEvent?.({ type: 'turn_completed', result });
        return result;
      },
    ),
    submitApprovals: vi.fn(),
  } as unknown as AgentRuntime;

  act(() => {
    mocks.surfaceProps?.onSubmit('Update the title');
  });

  await waitFor(() =>
    expect(
      mocks.surfaceProps?.entries.some((entry) => entry.kind === 'approval'),
    ).toBe(true),
  );
}

describe('AgentFrame', () => {
  beforeEach(() => {
    testUser += 1;
    localStorage.clear();
    sessionStorage.clear();
    mocks.surfaceProps = undefined;
    mocks.runtime = undefined;
    mocks.runtimeConfig = undefined;
    mocks.runtimeConfigs.length = 0;
    clearSessionLocalFiles();
  });

  afterEach(() => {
    cleanup();
    clearSessionLocalFiles();
    vi.restoreAllMocks();
  });

  it('keeps chat disabled until the selected provider has both a key and model', () => {
    render(
      <AgentFrame
        {...props({
          config: {
            ...DEFAULT_CONFIG,
            provider: 'anthropic',
            anthropicApiKey: 'sk-ant-test-key',
            anthropicModel: '',
          },
        })}
      />,
    );

    expect(mocks.surfaceProps?.connection).toMatchObject({
      status: 'setup',
      providerConfigStatus: 'missing',
      providerLabel: 'Anthropic (Claude)',
    });
    expect(mocks.surfaceProps?.composerDisabled).toBe(true);
  });

  it('checkpoints the user message before the provider turn resolves', () => {
    const frameProps = props({
      currentUserId: `immediate-checkpoint-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    mocks.runtime = {
      runTurn: vi.fn(() => new Promise<AgentTurnResult>(() => {})),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Remember this question immediately');
    });

    expect(mocks.runtime?.runTurn).toHaveBeenCalledOnce();
    expect(store.list()[0]?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Remember this question immediately',
      }),
    ]);
    expect(mocks.surfaceProps?.isRunning).toBe(true);
  });

  it('checkpoints a safe in-flight turn before unmount aborts it', async () => {
    const frameProps = props({
      currentUserId: `unmount-checkpoint-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    let turnSignal: AbortSignal | undefined;
    const dispose = vi.fn();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          args: { signal?: AbortSignal },
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          turnSignal = args.signal;
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_partial_unmount',
            delta: 'Partial response',
          });
          return await new Promise<AgentTurnResult>(() => {});
        },
      ),
      dispose,
    } as unknown as AgentRuntime;

    const rendered = render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Keep this partial turn');
    });
    await waitFor(() => expect(mocks.runtime?.runTurn).toHaveBeenCalledOnce());

    rendered.unmount();

    expect(turnSignal?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.list()[0]?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Keep this partial turn',
      }),
      expect.objectContaining({
        interrupted: true,
        role: 'assistant',
        text: 'Partial response',
      }),
    ]);
  });

  it('aborts a safe turn and uses replacement OAuth credentials after a cross-frame storage event', async () => {
    const frameProps = props({
      currentUserId: `oauth-storage-sync-user-${testUser}`,
    });
    seedDatoConnection(frameProps, 'oauth-old-token');
    let turnSignal: AbortSignal | undefined;
    const firstDispose = vi.fn();
    mocks.runtime = {
      runTurn: vi.fn(
        (args: { signal?: AbortSignal }) =>
          new Promise<AgentTurnResult>(() => {
            turnSignal = args.signal;
          }),
      ),
      dispose: firstDispose,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Keep reading with the current connection');
    });
    await waitFor(() => expect(mocks.runtime?.runTurn).toHaveBeenCalledOnce());

    const credentialStore = createCredentialStore({
      siteId: frameProps.siteId,
      currentUserId: frameProps.currentUserId,
    });
    credentialStore.save(
      createOAuthCredentials(
        {
          clientId: 'replacement-client',
          clientIdIssuedAt: 1_800_000_000,
          redirectUri: 'https://example.test/oauth/callback',
        },
        {
          accessToken: 'oauth-replacement-token',
          tokenType: 'Bearer',
          obtainedAt: 1_800_000_000,
        },
      ),
      { remember: true },
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: credentialStore.key,
          newValue: localStorage.getItem(credentialStore.key),
          storageArea: localStorage,
        }),
      );
    });

    await waitFor(() => {
      expect(turnSignal?.aborted).toBe(true);
      expect(firstDispose).toHaveBeenCalledOnce();
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });

    const replacementResult = completedResult({
      responseId: 'resp_replacement_oauth',
    });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'turn_completed',
            result: replacementResult,
          });
          return replacementResult;
        },
      ),
    } as unknown as AgentRuntime;
    act(() => {
      mocks.surfaceProps?.onSubmit('Continue with the replacement connection');
    });

    await waitFor(() => expect(mocks.runtime?.runTurn).toHaveBeenCalledOnce());
    expect(mocks.runtimeConfigs).toHaveLength(2);
    expect(mocks.runtimeConfigs[0]?.mcpAccessToken).toBe('oauth-old-token');
    expect(mocks.runtimeConfigs[1]?.mcpAccessToken).toBe(
      'oauth-replacement-token',
    );
  });

  it('surfaces a browser persistence failure after the immediate checkpoint', async () => {
    const frameProps = props({
      currentUserId: `persistence-warning-user-${testUser}`,
    });
    seedDatoConnection(frameProps);
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    mocks.runtime = {
      runTurn: vi.fn(() => new Promise<AgentTurnResult>(() => {})),
    } as unknown as AgentRuntime;
    render(<AgentFrame {...frameProps} />);

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === store.key) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    act(() => {
      mocks.surfaceProps?.onSubmit('This checkpoint cannot be saved');
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.persistenceWarning).toBe(
        'This chat could not be saved in this browser.',
      );
    });
  });

  it.each([
    {
      name: 'record surface without a saved record',
      frameProps: {
        surface: 'record' as const,
        scope: { type: 'custom' as const, id: 'new:article' },
      },
      expectedSurface: 'record',
      expectedPlaceholder: 'Ask about this record…',
    },
    {
      name: 'project surface even when record metadata is present',
      frameProps: {
        surface: 'project' as const,
        currentRecord: { id: 'highlighted-record', modelApiKey: 'article' },
        scope: { type: 'project' as const },
      },
      expectedSurface: 'project',
      expectedPlaceholder: 'Ask about this project…',
    },
  ])(
    'propagates the explicit $name',
    async ({ frameProps, expectedSurface, expectedPlaceholder }) => {
      const result = completedResult({ responseId: 'resp_surface' });
      mocks.runtime = {
        runTurn: vi.fn(
          async (
            _args: unknown,
            onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
          ) => {
            await onEvent?.({ type: 'turn_completed', result });
            return result;
          },
        ),
      } as unknown as AgentRuntime;

      render(<AgentFrame {...props(frameProps)} />);
      expect(mocks.surfaceProps?.composerPlaceholder).toBe(expectedPlaceholder);
      act(() => {
        mocks.surfaceProps?.onSubmit('Which host surface is active?');
      });

      await waitFor(() =>
        expect(mocks.runtime?.runTurn).toHaveBeenCalledOnce(),
      );
      expect(mocks.runtimeConfig?.context.surface).toBe(expectedSurface);
    },
  );

  it('keeps a recoverable DatoCMS attempt active until the turn completes', async () => {
    let continueTurn: (() => void) | undefined;
    const continueGate = new Promise<void>((resolve) => {
      continueTurn = resolve;
    });
    const result = completedResult({ text: 'I found the project details.' });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_diagnostics',
            delta: 'Partial ',
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_diagnostics',
            delta: 'answer',
          });
          await onEvent?.({
            type: 'activity',
            responseId: 'resp_complete',
            activity: {
              id: 'first-attempt',
              kind: 'mcp_tool',
              status: 'failed',
              label: 'Reading CMS content',
              error: 'The first query did not match.',
            },
          });
          await continueGate;
          await onEvent?.({
            type: 'activity',
            responseId: 'resp_complete',
            activity: {
              id: 'second-attempt',
              kind: 'mcp_tool',
              status: 'completed',
              label: 'Reading CMS content',
            },
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props()} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Describe this project');
    });

    await waitFor(() => {
      const activity = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'activity',
      );
      expect(activity?.kind === 'activity' && activity.phase).toBe('running');
      expect(
        activity?.kind === 'activity' &&
          activity.activities.find((item) => item.id === 'first-attempt')
            ?.status,
      ).toBe('error');
      expect(mocks.surfaceProps?.isRunning).toBe(true);
    });

    await act(async () => {
      continueTurn?.();
      await continueGate;
    });

    await waitFor(() => {
      const activity = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'activity',
      );
      expect(activity?.kind === 'activity' && activity.phase).toBe('completed');
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });
  });

  it('adds a host snapshot once per response chain and refreshes it when context changes', async () => {
    let snapshot = {
      text: 'surface=standalone\nproject_map|complete=true',
      fingerprint: 'v1:project:first',
    };
    let responseNumber = 0;
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          responseNumber += 1;
          const result = completedResult({
            responseId: `resp_context_${responseNumber}`,
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;
    const frameProps = props({
      currentUserId: `context-user-${testUser}`,
      loadHostContext: vi.fn(async () => snapshot),
    });

    render(<AgentFrame {...frameProps} />);

    act(() => {
      mocks.surfaceProps?.onSubmit('First question');
    });
    await waitFor(() =>
      expect(mocks.runtime?.runTurn).toHaveBeenCalledTimes(1),
    );
    expect(mocks.runtime?.runTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        previousResponseId: undefined,
        injectHostContext: true,
      }),
      expect.any(Function),
    );
    expect(mocks.runtimeConfigs[0].hostContext).toBe(snapshot.text);

    act(() => {
      mocks.surfaceProps?.onSubmit('Follow-up question');
    });
    await waitFor(() =>
      expect(mocks.runtime?.runTurn).toHaveBeenCalledTimes(2),
    );
    expect(mocks.runtime?.runTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previousResponseId: 'resp_context_1',
        injectHostContext: false,
      }),
      expect.any(Function),
    );

    snapshot = {
      text: 'surface=standalone\nproject_map|complete=true\nmodel article',
      fingerprint: 'v1:project:second',
    };
    act(() => {
      mocks.surfaceProps?.onSubmit('Question after a schema change');
    });
    await waitFor(() =>
      expect(mocks.runtime?.runTurn).toHaveBeenCalledTimes(3),
    );
    expect(mocks.runtime?.runTurn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        previousResponseId: 'resp_context_2',
        injectHostContext: true,
      }),
      expect.any(Function),
    );

    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    expect(store.list()[0]).toMatchObject({
      previousResponseId: 'resp_context_3',
      responseProvider: 'openai',
      responseModel: DEFAULT_CONFIG.model,
      hostContextFingerprint: 'v1:project:second',
    });
  });

  it('recovers once from a stale OpenAI response chain using local history and fresh host context', async () => {
    const firstSnapshot = {
      text: 'surface=standalone\nproject_map|version=first',
      fingerprint: 'v1:project:first',
    };
    const freshSnapshot = {
      text: 'surface=standalone\nproject_map|version=fresh',
      fingerprint: 'v1:project:fresh',
    };
    const loadHostContext = vi
      .fn()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(freshSnapshot);
    const frameProps = props({
      currentUserId: `stale-chain-user-${testUser}`,
      loadHostContext,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'stale-chain',
        title: 'Earlier question',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_stale',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
        hostContextFingerprint: firstSnapshot.fingerprint,
      }),
    );
    const staleError = {
      code: 'api_error' as const,
      message: "No response found with id 'resp_stale'.",
      retryable: true,
    };
    const staleResult = completedResult({
      status: 'failed',
      responseId: 'resp_stale',
      error: staleError,
    });
    const recoveredResult = completedResult({
      responseId: 'resp_recovered',
      text: 'Recovered answer',
    });
    let releaseRetry: (() => void) | undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let invocation = 0;
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        invocation += 1;
        if (invocation === 1) {
          await onEvent?.({
            type: 'error',
            responseId: 'resp_stale',
            error: staleError,
          });
          await onEvent?.({ type: 'turn_completed', result: staleResult });
          return staleResult;
        }

        await retryGate;
        await onEvent?.({
          type: 'text_delta',
          responseId: 'resp_recovered',
          delta: 'Recovered answer',
        });
        await onEvent?.({
          type: 'turn_completed',
          result: recoveredResult,
        });
        return recoveredResult;
      },
    );
    mocks.runtime = {
      runTurn,
      dispose: vi.fn(),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Follow up safely');
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(loadHostContext).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        history: [{ role: 'user', text: 'Earlier question' }],
        previousResponseId: 'resp_stale',
        injectHostContext: false,
      }),
    );
    expect(runTurn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        history: [{ role: 'user', text: 'Earlier question' }],
        previousResponseId: undefined,
        injectHostContext: true,
      }),
    );
    expect(mocks.runtimeConfigs).toHaveLength(2);
    expect(mocks.runtimeConfigs[1]?.hostContext).toBe(freshSnapshot.text);
    expect(store.list()[0]?.previousResponseId).toBeUndefined();
    expect(
      mocks.surfaceProps?.entries.some(
        (entry) => entry.kind === 'message' && Boolean(entry.error),
      ),
    ).toBe(false);

    await act(async () => {
      releaseRetry?.();
      await retryGate;
    });

    await waitFor(() =>
      expect(store.list()[0]?.previousResponseId).toBe('resp_recovered'),
    );
    expect(
      store.list()[0]?.messages.map(({ role, text }) => ({ role, text })),
    ).toEqual([
      { role: 'user', text: 'Earlier question' },
      { role: 'user', text: 'Follow up safely' },
      { role: 'assistant', text: 'Recovered answer' },
    ]);
  });

  it('does not rebuild a stale chain after an unsafe operation was dispatched', async () => {
    const frameProps = props({
      currentUserId: `unsafe-stale-chain-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'unsafe-stale-chain',
        title: 'Earlier write request',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_before_unsafe',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const approvalRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_unsafe_approval',
      approvals: [unsafeApproval],
    });
    const staleError = {
      code: 'api_error' as const,
      message:
        "Previous response with id 'resp_unsafe_approval' was not found.",
      retryable: true,
    };
    const failedContinuation = completedResult({
      status: 'failed',
      responseId: 'resp_unsafe_approval',
      error: staleError,
    });
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'approval_required',
          responseId: 'resp_unsafe_approval',
          approval: unsafeApproval,
        });
        await onEvent?.({
          type: 'turn_completed',
          result: approvalRequired,
        });
        return approvalRequired;
      },
    );
    const submitApprovals = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'error',
          responseId: 'resp_unsafe_approval',
          error: staleError,
        });
        await onEvent?.({
          type: 'turn_completed',
          result: failedContinuation,
        });
        return failedContinuation;
      },
    );
    mocks.runtime = {
      runTurn,
      submitApprovals,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Apply the prepared change');
    });
    await waitFor(() =>
      expect(
        mocks.surfaceProps?.entries.some((entry) => entry.kind === 'approval'),
      ).toBe(true),
    );

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => expect(submitApprovals).toHaveBeenCalledOnce());
    expect(runTurn).toHaveBeenCalledOnce();
    expect(store.list()[0]?.previousResponseId).toBeUndefined();
    const settledApproval = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    expect(
      settledApproval?.kind === 'approval' && settledApproval.approval.error,
    ).toContain('not found');
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'message' && entry.role === 'assistant',
      ),
    ).toMatchObject({
      failure: { retryable: false },
    });
  });

  it('does not retry ordinary OpenAI failures that are unrelated to the response chain', async () => {
    const frameProps = props({
      currentUserId: `non-chain-error-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'non-chain-error',
        title: 'Earlier question',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_valid',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const providerError = {
      code: 'api_error' as const,
      message: 'The selected model is temporarily unavailable.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_failed',
      error: providerError,
    });
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'error',
          responseId: 'resp_failed',
          error: providerError,
        });
        await onEvent?.({ type: 'turn_completed', result: failed });
        return failed;
      },
    );
    mocks.runtime = {
      runTurn,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Follow up');
    });

    await waitFor(() => expect(mocks.surfaceProps?.isRunning).toBe(false));
    expect(runTurn).toHaveBeenCalledOnce();
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'message' && entry.role === 'assistant',
      ),
    ).toMatchObject({
      error: 'The selected model is temporarily unavailable.',
      interrupted: true,
      failure: { retryable: true },
    });
  });

  it('switches providers without reusing opaque response state and keeps visible history', async () => {
    const frameProps = props({
      currentUserId: `anthropic-user-${testUser}`,
      config: {
        ...DEFAULT_CONFIG,
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test-key',
        anthropicModel: 'claude-sonnet-5',
        anthropicReasoningEffort: 'high',
      },
      loadHostContext: vi.fn(async () => ({
        text: 'surface=standalone\nproject_map|complete=true',
        fingerprint: 'v1:project:anthropic',
      })),
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'openai-chat',
        title: 'Earlier OpenAI question',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_openai',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
        hostContextFingerprint: 'v1:project:openai',
      }),
    );
    const result = completedResult({ responseId: 'msg_claude' });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Continue with Claude');
    });

    await waitFor(() =>
      expect(mocks.runtime?.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          history: [
            {
              role: 'user',
              text: 'Earlier OpenAI question',
            },
          ],
          previousResponseId: undefined,
          injectHostContext: true,
        }),
        expect.any(Function),
      ),
    );
    expect(mocks.runtimeConfig).toMatchObject({
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key',
      model: 'claude-sonnet-5',
      reasoningEffort: 'high',
    });
    expect(mocks.surfaceProps?.connection).toMatchObject({
      providerConfigStatus: 'configured',
      providerLabel: 'Anthropic (Claude)',
    });
    expect(store.list()[0]).toMatchObject({
      responseProvider: 'anthropic',
      responseModel: 'claude-sonnet-5',
    });
    expect(store.list()[0]?.previousResponseId).toBeUndefined();
    expect(store.list()[0]?.hostContextFingerprint).toBeUndefined();
  });

  it('drops an OpenAI response chain after the configured model changes', async () => {
    const frameProps = props({
      currentUserId: `model-switch-user-${testUser}`,
      config: {
        ...DEFAULT_CONFIG,
        openAiApiKey: 'sk-test-key',
        model: 'gpt-5.6-sol',
      },
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'old-model-chat',
        title: 'Earlier model question',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_old_model',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const result = completedResult({ responseId: 'resp_new_model' });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Continue with the new model');
    });

    await waitFor(() =>
      expect(mocks.runtime?.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          history: [{ role: 'user', text: 'Earlier model question' }],
          previousResponseId: undefined,
        }),
        expect.any(Function),
      ),
    );
    expect(store.list()[0]).toMatchObject({
      previousResponseId: 'resp_new_model',
      responseProvider: 'openai',
      responseModel: 'gpt-5.6-sol',
    });
  });

  it('clears a stale response chain when a refreshed-context turn fails', async () => {
    const frameProps = props({
      currentUserId: `failed-context-user-${testUser}`,
      loadHostContext: vi.fn(async () => ({
        text: 'surface=standalone\nproject_map|complete=true\nmodel changed',
        fingerprint: 'v1:project:changed',
      })),
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'existing-context',
        title: 'Existing context chat',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_existing_context',
        hostContextFingerprint: 'v1:project:old',
      }),
    );
    const failure = {
      code: 'api_error' as const,
      message: 'Temporary provider failure.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_failed_context',
      error: failure,
    });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'error',
            responseId: failed.responseId,
            error: failure,
          });
          await onEvent?.({ type: 'turn_completed', result: failed });
          return failed;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Try with refreshed context');
    });

    await waitFor(() =>
      expect(mocks.runtime?.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          previousResponseId: 'resp_existing_context',
          injectHostContext: true,
        }),
        expect.any(Function),
      ),
    );
    expect(store.list()[0]?.previousResponseId).toBeUndefined();
    expect(store.list()[0]?.hostContextFingerprint).toBeUndefined();
    const failedAssistant = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'message' && entry.role === 'assistant',
    );
    expect(failedAssistant).toMatchObject({
      kind: 'message',
      role: 'assistant',
      content: '',
      error: failure.message,
    });
  });

  it('does not duplicate a thrown runtime error as assistant content', async () => {
    mocks.runtime = {
      runTurn: vi
        .fn()
        .mockRejectedValue(new Error('Temporary provider failure.')),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props()} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Describe this project');
    });

    await waitFor(() => {
      const failedAssistant = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'message' && entry.role === 'assistant',
      );
      expect(failedAssistant).toMatchObject({
        kind: 'message',
        role: 'assistant',
        content: '',
        error: 'Temporary provider failure.',
        streaming: false,
      });
    });
  });

  it('rebuilds an OpenAI chain from history without interrupted partial text', async () => {
    const frameProps = props({
      currentUserId: `interrupted-history-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'established-chain',
        title: 'Earlier request',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_established',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const failure = {
      code: 'api_error' as const,
      message: 'The provider connection was interrupted.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_partial',
      text: 'Partial answer',
      error: failure,
    });
    const completed = completedResult({ responseId: 'resp_recovered' });
    let invocation = 0;
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        invocation += 1;
        if (invocation === 1) {
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_partial',
            delta: 'Partial answer',
          });
          await onEvent?.({
            type: 'error',
            responseId: 'resp_partial',
            error: failure,
          });
          await onEvent?.({ type: 'turn_completed', result: failed });
          return failed;
        }

        await onEvent?.({ type: 'turn_completed', result: completed });
        return completed;
      },
    );
    mocks.runtime = {
      runTurn,
      dispose: vi.fn(),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('First request');
    });

    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledOnce();
      expect(runTurn.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          previousResponseId: 'resp_established',
        }),
      );
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) =>
            entry.kind === 'message' &&
            entry.role === 'assistant' &&
            entry.content === 'Partial answer',
        ),
      ).toMatchObject({
        interrupted: true,
        error: failure.message,
      });
    });

    expect(store.list()[0]?.previousResponseId).toBeUndefined();
    expect(
      store.list()[0]?.messages.find((message) => message.role === 'assistant'),
    ).toMatchObject({
      text: 'Partial answer',
      interrupted: true,
    });

    act(() => {
      mocks.surfaceProps?.onSubmit('Second request');
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(runTurn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        history: [
          { role: 'user', text: 'Earlier request' },
          { role: 'user', text: 'First request' },
        ],
        previousResponseId: undefined,
      }),
    );
    expect(
      mocks.surfaceProps?.entries.some(
        (entry) =>
          entry.kind === 'message' &&
          entry.role === 'assistant' &&
          entry.content === 'Partial answer',
      ),
    ).toBe(true);
  });

  it('marks an approved operation as unconfirmed when continuation fails', async () => {
    render(<AgentFrame {...props()} />);
    await startApprovalTurn();
    const failure = {
      code: 'api_error' as const,
      message: 'The continuation failed.',
      retryable: false,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_failed',
      error: failure,
    });
    if (!mocks.runtime) {
      throw new Error('Expected a runtime.');
    }
    vi.mocked(mocks.runtime.submitApprovals).mockImplementation(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'error',
          responseId: 'resp_failed',
          error: failure,
        });
        await onEvent?.({ type: 'turn_completed', result: failed });
        return failed;
      },
    );

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    expect(approvalEntry?.kind).toBe('approval');
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => {
      const entry = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'approval',
      );
      expect(entry?.kind === 'approval' && entry.approval.status).toBe('error');
      expect(entry?.kind === 'approval' && entry.approval.error).toContain(
        'continuation failed',
      );
      const activity = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'activity',
      );
      expect(activity?.kind === 'activity' && activity.phase).toBe('failed');
    });
  });

  it('recovers a dispatched approval after unmount without replaying it', async () => {
    const frameProps = props({
      currentUserId: `unsafe-recovery-user-${testUser}`,
    });
    const rendered = render(<AgentFrame {...frameProps} />);
    await startApprovalTurn();
    let finishSubmission: ((result: AgentTurnResult) => void) | undefined;
    const submitApprovals = vi.fn(
      (args: ContinueApprovalsArgs) =>
        new Promise<AgentTurnResult>((resolve) => {
          args.unsafeDispatchCallbacks?.beforeDispatch(['approval_1']);
          finishSubmission = resolve;
        }),
    );
    if (!mocks.runtime) {
      throw new Error('Expected a runtime.');
    }
    mocks.runtime.submitApprovals = submitApprovals;

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });
    await waitFor(() => expect(submitApprovals).toHaveBeenCalledOnce());

    const journalStore = createUnsafeDispatchJournalStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    expect(journalStore.read()?.operations[0]?.state).toBe('dispatched');

    rendered.unmount();
    const replacementRuntime = {
      runTurn: vi.fn(),
      submitApprovals: vi.fn(),
    } as unknown as AgentRuntime;
    mocks.runtime = replacementRuntime;
    render(<AgentFrame {...frameProps} />);

    expect(
      mocks.surfaceProps?.entries.find(
        (entry) =>
          entry.kind === 'message' &&
          entry.role === 'assistant' &&
          entry.content.includes('may already have run'),
      ),
    ).toBeTruthy();
    expect(replacementRuntime.runTurn).not.toHaveBeenCalled();
    expect(replacementRuntime.submitApprovals).not.toHaveBeenCalled();
    expect(journalStore.read()).toBeUndefined();

    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    expect(store.list()[0]?.previousResponseId).toBeUndefined();
    expect(store.list()[0]?.messages.map((message) => message.text)).toEqual([
      'Update the title',
      expect.stringContaining('may already have run'),
    ]);

    await act(async () => {
      finishSubmission?.(
        completedResult({
          status: 'aborted',
          error: {
            code: 'aborted',
            message: 'The request was cancelled.',
            retryable: false,
          },
        }),
      );
      await Promise.resolve();
    });
  });

  it('keeps a mounted failed dispatch journal until reload reports the unknown outcome', async () => {
    const frameProps = props({
      currentUserId: `unsafe-mounted-failure-user-${testUser}`,
    });
    const rendered = render(<AgentFrame {...frameProps} />);
    await startApprovalTurn();
    const failure = {
      code: 'unsafe_outcome_unknown' as const,
      message:
        'The approved DatoCMS change may have run, but its result could not be confirmed.',
      retryable: false,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_failed_dispatch',
      error: failure,
    });
    const submitApprovals = vi.fn(
      async (
        args: ContinueApprovalsArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        args.unsafeDispatchCallbacks?.beforeDispatch(['approval_1']);
        await onEvent?.({
          type: 'error',
          responseId: failed.responseId,
          error: failure,
        });
        await onEvent?.({ type: 'turn_completed', result: failed });
        return failed;
      },
    );
    if (!mocks.runtime) {
      throw new Error('Expected a runtime.');
    }
    mocks.runtime.submitApprovals = submitApprovals;

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });
    await waitFor(() => expect(submitApprovals).toHaveBeenCalledOnce());

    const journalStore = createUnsafeDispatchJournalStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    expect(journalStore.read()?.operations[0]?.state).toBe('dispatched');

    rendered.unmount();
    const replacementRuntime = {
      runTurn: vi.fn(),
      submitApprovals: vi.fn(),
    } as unknown as AgentRuntime;
    mocks.runtime = replacementRuntime;
    render(<AgentFrame {...frameProps} />);

    expect(
      mocks.surfaceProps?.entries.find(
        (entry) =>
          entry.kind === 'message' &&
          entry.role === 'assistant' &&
          entry.content.includes('may already have run'),
      ),
    ).toBeTruthy();
    expect(replacementRuntime.runTurn).not.toHaveBeenCalled();
    expect(replacementRuntime.submitApprovals).not.toHaveBeenCalled();
  });

  it('does not dispatch approval when durable journaling is unavailable', async () => {
    render(<AgentFrame {...props()} />);
    await startApprovalTurn();
    const submitApprovals = vi.fn();
    if (!mocks.runtime) {
      throw new Error('Expected a runtime.');
    }
    mocks.runtime.submitApprovals = submitApprovals;
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key.includes('unsafe-dispatch')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => {
      const failedApproval = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'approval',
      );
      expect(
        failedApproval?.kind === 'approval' && failedApproval.approval.status,
      ).toBe('error');
      expect(
        failedApproval?.kind === 'approval' && failedApproval.approval.error,
      ).toContain('was not sent');
    });
    expect(submitApprovals).not.toHaveBeenCalled();
  });

  it('rebuilds history when an approval continuation throws', async () => {
    const frameProps = props({
      currentUserId: `approval-history-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'approval-chain',
        title: 'Earlier request',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_before_approval',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const approvalRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_approval_throw',
      text: 'I prepared the change.',
      approvals: [unsafeApproval],
    });
    const recovered = completedResult({ responseId: 'resp_after_approval' });
    let invocation = 0;
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        invocation += 1;
        if (invocation === 1) {
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_approval_throw',
            delta: 'I prepared the change.',
          });
          await onEvent?.({
            type: 'activity',
            responseId: 'resp_approval_throw',
            activity: {
              id: unsafeApproval.approvalRequestId,
              kind: 'mcp_tool',
              status: 'waiting',
              label: 'Preparing a CMS change',
            },
          });
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_approval_throw',
            approval: unsafeApproval,
          });
          await onEvent?.({
            type: 'turn_completed',
            result: approvalRequired,
          });
          return approvalRequired;
        }

        await onEvent?.({ type: 'turn_completed', result: recovered });
        return recovered;
      },
    );
    const submitApprovals = vi
      .fn()
      .mockRejectedValue(new Error('The approval continuation disconnected.'));
    mocks.runtime = {
      runTurn,
      submitApprovals,
      dispose: vi.fn(),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Update the title');
    });

    await waitFor(() =>
      expect(
        mocks.surfaceProps?.entries.some((entry) => entry.kind === 'approval'),
      ).toBe(true),
    );
    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => {
      const settledApproval = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'approval',
      );
      expect(
        settledApproval?.kind === 'approval' && settledApproval.approval.status,
      ).toBe('error');
      expect(store.list()[0]?.previousResponseId).toBeUndefined();
      expect(
        store
          .list()[0]
          ?.messages.find((message) => message.role === 'assistant'),
      ).toMatchObject({
        text: 'I prepared the change.',
        interrupted: true,
      });
    });

    act(() => {
      mocks.surfaceProps?.onSubmit('What happened?');
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(runTurn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        history: [
          { role: 'user', text: 'Earlier request' },
          { role: 'user', text: 'Update the title' },
        ],
        previousResponseId: undefined,
      }),
    );
  });

  it('keeps a confirmed operation approved when later narration fails', async () => {
    render(<AgentFrame {...props()} />);
    await startApprovalTurn();
    const failure = {
      code: 'api_error' as const,
      message: 'The final summary failed.',
      retryable: false,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_failed',
      error: failure,
      confirmedApprovalIds: ['approval_1'],
    });
    if (!mocks.runtime) {
      throw new Error('Expected a runtime.');
    }
    vi.mocked(mocks.runtime.submitApprovals).mockImplementation(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'error',
          responseId: 'resp_failed',
          error: failure,
        });
        await onEvent?.({ type: 'turn_completed', result: failed });
        return failed;
      },
    );

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => {
      const entry = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'approval',
      );
      expect(entry?.kind === 'approval' && entry.approval.status).toBe(
        'approved',
      );
      const activity = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'activity',
      );
      expect(activity?.kind === 'activity' && activity.phase).toBe('failed');
    });
  });

  it('keeps an approved decision approved after a successful continuation', async () => {
    render(<AgentFrame {...props()} />);
    await startApprovalTurn();
    const completed = completedResult({ text: 'The title was updated.' });
    if (!mocks.runtime) {
      throw new Error('Expected a runtime.');
    }
    vi.mocked(mocks.runtime.submitApprovals).mockImplementation(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({ type: 'turn_completed', result: completed });
        return completed;
      },
    );

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => {
      const entry = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'approval',
      );
      expect(entry?.kind === 'approval' && entry.approval.status).toBe(
        'approved',
      );
      const activity = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'activity',
      );
      expect(
        activity?.kind === 'activity' &&
          activity.activities.find((item) => item.id === 'approval_1')?.status,
      ).toBe('success');
      expect(activity?.kind === 'activity' && activity.phase).toBe('completed');
    });
    expect(mocks.runtime.submitApprovals).toHaveBeenCalledWith(
      expect.objectContaining({
        decisions: [
          expect.objectContaining({
            approvalRequestId: 'approval_1',
            approve: true,
          }),
        ],
      }),
      expect.any(Function),
    );
  });

  it('blocks approval when the record became dirty after proposal', async () => {
    render(
      <AgentFrame
        {...props({
          currentRecord: {
            id: 'item',
            modelApiKey: 'page',
            hasUnsavedChanges: true,
          },
          scope: { type: 'record', recordId: 'item' },
        })}
      />,
    );
    await startApprovalTurn();

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    act(() => {
      if (approvalEntry?.kind === 'approval') {
        mocks.surfaceProps?.onApproveUnsafeAction?.(approvalEntry.approval);
      }
    });

    await waitFor(() => {
      const entry = mocks.surfaceProps?.entries.find(
        (candidate) => candidate.kind === 'approval',
      );
      expect(entry?.kind === 'approval' && entry.approval.status).toBe(
        'pending',
      );
      expect(entry?.kind === 'approval' && entry.approval.error).toContain(
        'Save or discard',
      );
    });
    expect(mocks.runtime?.submitApprovals).not.toHaveBeenCalled();
  });

  it('turns auto-approve on only after confirmation and disables it immediately', async () => {
    const frameProps = props();
    render(<AgentFrame {...frameProps} />);

    expect(mocks.surfaceProps?.autoApproveEnabled).toBe(false);
    await act(async () => {
      await mocks.surfaceProps?.onAutoApproveChange?.(true);
    });

    expect(frameProps.onConfirmEnableAutoApprove).toHaveBeenCalledOnce();
    expect(mocks.surfaceProps?.autoApproveEnabled).toBe(true);
    const store = createAutoApprovalStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
    });
    expect(store.isEnabled()).toBe(true);

    await act(async () => {
      await mocks.surfaceProps?.onAutoApproveChange?.(false);
    });
    expect(mocks.surfaceProps?.autoApproveEnabled).toBe(false);
    expect(store.isEnabled()).toBe(false);
  });

  it('opens only one auto-approve confirmation chain at a time', async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const onConfirmEnableAutoApprove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    render(
      <AgentFrame
        {...props({
          onConfirmEnableAutoApprove,
        })}
      />,
    );
    const change = mocks.surfaceProps?.onAutoApproveChange;
    if (!change) {
      throw new Error('Expected the auto-approve control.');
    }

    let first: ReturnType<typeof change>;
    let second: ReturnType<typeof change>;
    act(() => {
      first = change(true);
      second = change(true);
    });

    await expect(second).resolves.toBe(false);
    expect(onConfirmEnableAutoApprove).toHaveBeenCalledOnce();

    await act(async () => {
      resolveConfirmation?.(true);
      await first;
    });
    expect(mocks.surfaceProps?.autoApproveEnabled).toBe(true);
  });

  it('blocks receipts and auto-approve while approval details are open', async () => {
    let closeDetails: (() => void) | undefined;
    const onReviewApprovalDetails = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          closeDetails = resolve;
        }),
    );
    const onConfirmEnableAutoApprove = vi.fn().mockResolvedValue(true);
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    render(
      <AgentFrame
        {...props({
          navigator,
          onConfirmEnableAutoApprove,
          onReviewApprovalDetails,
        })}
      />,
    );
    await startApprovalTurn({ withRecordReceipt: true });

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    const recordEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records',
    );
    if (approvalEntry?.kind !== 'approval' || recordEntry?.kind !== 'records') {
      throw new Error('Expected approval and record entries.');
    }

    act(() => {
      mocks.surfaceProps?.onReviewUnsafeAction?.(approvalEntry.approval);
    });
    expect(onReviewApprovalDetails).toHaveBeenCalledOnce();
    expect(mocks.surfaceProps?.hostActionPending).toBe(true);

    await act(async () => {
      await mocks.surfaceProps?.onOpenRecord?.(
        recordEntry.records[0],
        recordEntry.id,
      );
      await expect(
        mocks.surfaceProps?.onAutoApproveChange?.(true),
      ).resolves.toBe(false);
    });
    expect(navigator.openRecord).not.toHaveBeenCalled();
    expect(onConfirmEnableAutoApprove).not.toHaveBeenCalled();

    act(() => closeDetails?.());
    await waitFor(() => {
      expect(mocks.surfaceProps?.hostActionPending).toBe(false);
    });
  });

  it('blocks approval details and auto-approve while a receipt host action is open', async () => {
    let closeRecord: (() => void) | undefined;
    const recordModal = new Promise<void>((resolve) => {
      closeRecord = resolve;
    });
    const onReviewApprovalDetails = vi.fn().mockResolvedValue(undefined);
    const onConfirmEnableAutoApprove = vi.fn().mockResolvedValue(true);
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn(() => recordModal),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    render(
      <AgentFrame
        {...props({
          navigator,
          onConfirmEnableAutoApprove,
          onReviewApprovalDetails,
        })}
      />,
    );
    await startApprovalTurn({ withRecordReceipt: true });

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    const recordEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records',
    );
    if (approvalEntry?.kind !== 'approval' || recordEntry?.kind !== 'records') {
      throw new Error('Expected approval and record entries.');
    }

    let opening: void | Promise<void>;
    act(() => {
      opening = mocks.surfaceProps?.onOpenRecord?.(
        recordEntry.records[0],
        recordEntry.id,
      );
    });
    expect(mocks.surfaceProps?.hostActionPending).toBe(true);

    act(() => {
      mocks.surfaceProps?.onReviewUnsafeAction?.(approvalEntry.approval);
    });
    await act(async () => {
      await expect(
        mocks.surfaceProps?.onAutoApproveChange?.(true),
      ).resolves.toBe(false);
    });
    expect(onReviewApprovalDetails).not.toHaveBeenCalled();
    expect(onConfirmEnableAutoApprove).not.toHaveBeenCalled();

    closeRecord?.();
    await act(async () => {
      await opening;
    });
    expect(mocks.surfaceProps?.hostActionPending).toBe(false);
  });

  it('blocks receipt and approval-detail launchers throughout auto-approve confirmation', async () => {
    let finishConfirmation: ((confirmed: boolean) => void) | undefined;
    const onConfirmEnableAutoApprove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishConfirmation = resolve;
        }),
    );
    const onReviewApprovalDetails = vi.fn().mockResolvedValue(undefined);
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(async () => {
        await mocks.runtimeConfig?.navigation.presentRecords({
          title: 'Record',
          records: [{ itemId: 'record-1', label: 'Record' }],
        });
        return result;
      }),
    } as unknown as AgentRuntime;

    render(
      <AgentFrame
        {...props({
          navigator,
          onConfirmEnableAutoApprove,
          onReviewApprovalDetails,
        })}
      />,
    );
    act(() => {
      mocks.surfaceProps?.onSubmit('Show a record');
    });
    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });
    const recordEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records',
    );
    if (recordEntry?.kind !== 'records') {
      throw new Error('Expected a record entry.');
    }

    let confirmation: boolean | undefined | Promise<boolean | undefined>;
    act(() => {
      confirmation = mocks.surfaceProps?.onAutoApproveChange?.(true);
    });
    expect(mocks.surfaceProps?.hostActionPending).toBe(true);

    await act(async () => {
      await mocks.surfaceProps?.onOpenRecord?.(
        recordEntry.records[0],
        recordEntry.id,
      );
    });
    act(() => {
      mocks.surfaceProps?.onReviewUnsafeAction?.({
        id: 'review',
        title: 'Review this change',
        description: 'Review generated details.',
        actionLabel: 'Approve',
        status: 'pending',
      });
    });
    expect(navigator.openRecord).not.toHaveBeenCalled();
    expect(onReviewApprovalDetails).not.toHaveBeenCalled();

    finishConfirmation?.(false);
    await act(async () => {
      await confirmation;
    });
    expect(mocks.surfaceProps?.hostActionPending).toBe(false);
    expect(mocks.surfaceProps?.autoApproveEnabled).toBe(false);
  });

  it('releases the host-action lock when approval details fail to open', async () => {
    const onReviewApprovalDetails = vi
      .fn()
      .mockRejectedValue(new Error('Host modal failed'));
    render(<AgentFrame {...props({ onReviewApprovalDetails })} />);
    await startApprovalTurn();

    const approvalEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'approval',
    );
    if (approvalEntry?.kind !== 'approval') {
      throw new Error('Expected an approval entry.');
    }

    act(() => {
      mocks.surfaceProps?.onReviewUnsafeAction?.(approvalEntry.approval);
    });
    await waitFor(() => {
      expect(onReviewApprovalDetails).toHaveBeenCalledOnce();
      expect(mocks.surfaceProps?.hostActionPending).toBe(false);
    });
  });

  it('automatically submits one complete unsafe approval bundle', async () => {
    const frameProps = props();
    enableAutoApproval(frameProps);
    const approval = unsafeApprovalWithId('approval_auto');
    const approvalRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_auto',
      approvals: [approval],
    });
    const completed = completedResult({
      responseId: 'resp_auto_completed',
      text: 'The title was updated.',
    });
    const submitApprovals = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({ type: 'turn_completed', result: completed });
        return completed;
      },
    );
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_auto',
            approval,
          });
          await onEvent?.({
            type: 'turn_completed',
            result: approvalRequired,
          });
          return approvalRequired;
        },
      ),
      submitApprovals,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Update the title');
    });

    await waitFor(() => expect(submitApprovals).toHaveBeenCalledOnce());
    expect(submitApprovals).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: 'resp_auto',
        decisions: [
          {
            approvalRequestId: 'approval_auto',
            approve: true,
          },
        ],
      }),
      expect.any(Function),
    );
    const entry = mocks.surfaceProps?.entries.find(
      (candidate) =>
        candidate.kind === 'approval' &&
        candidate.approval.id === 'approval_auto',
    );
    expect(entry?.kind === 'approval' && entry.approval.automatic).toBe(true);
    expect(entry?.kind === 'approval' && entry.approval.status).toBe(
      'approved',
    );
  });

  it('never offers retry after an auto-approved operation was dispatched', async () => {
    const frameProps = props({
      currentUserId: `unsafe-auto-retry-user-${testUser}`,
    });
    enableAutoApproval(frameProps);
    const approval = unsafeApprovalWithId('approval_auto_failure');
    const approvalRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_auto_failure',
      approvals: [approval],
    });
    const failure = {
      code: 'api_error' as const,
      message: 'The provider summary failed after the change.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_auto_failure',
      error: failure,
    });
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'approval_required',
          responseId: 'resp_auto_failure',
          approval,
        });
        await onEvent?.({ type: 'turn_completed', result: approvalRequired });
        return approvalRequired;
      },
    );
    const submitApprovals = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({
          type: 'error',
          responseId: 'resp_auto_failure',
          error: failure,
        });
        await onEvent?.({ type: 'turn_completed', result: failed });
        return failed;
      },
    );
    mocks.runtime = {
      runTurn,
      submitApprovals,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Apply the approved change');
    });

    await waitFor(() => expect(submitApprovals).toHaveBeenCalledOnce());
    const failureEntry = mocks.surfaceProps?.entries.find(
      (entry) =>
        entry.kind === 'message' && entry.role === 'assistant' && entry.failure,
    );
    if (failureEntry?.kind !== 'message' || !failureEntry.failure) {
      throw new Error('Expected terminal failure metadata.');
    }
    expect(failureEntry.failure.retryable).toBe(false);
    const failureId = failureEntry.failure.id;

    await act(async () => {
      await mocks.surfaceProps?.onRetryFailedTurn?.(failureId);
    });
    expect(runTurn).toHaveBeenCalledOnce();
    expect(submitApprovals).toHaveBeenCalledOnce();
  });

  it('waits for turn completion and submits grouped approvals exactly once', async () => {
    const frameProps = props();
    enableAutoApproval(frameProps);
    const approvals = [
      unsafeApprovalWithId('approval_group_one'),
      unsafeApprovalWithId('approval_group_two'),
    ];
    const approvalRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_group',
      approvals,
    });
    const completed = completedResult({ responseId: 'resp_group_completed' });
    const submitApprovals = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({ type: 'turn_completed', result: completed });
        return completed;
      },
    );
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_group',
            approval: approvals[0],
          });
          expect(submitApprovals).not.toHaveBeenCalled();
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_group',
            approval: approvals[1],
          });
          expect(submitApprovals).not.toHaveBeenCalled();
          await onEvent?.({
            type: 'turn_completed',
            result: approvalRequired,
          });
          expect(submitApprovals).not.toHaveBeenCalled();
          return approvalRequired;
        },
      ),
      submitApprovals,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Update both titles');
    });

    await waitFor(() => expect(submitApprovals).toHaveBeenCalledOnce());
    expect(submitApprovals).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: 'resp_group',
        decisions: [
          { approvalRequestId: 'approval_group_one', approve: true },
          { approvalRequestId: 'approval_group_two', approve: true },
        ],
      }),
      expect.any(Function),
    );
  });

  it('uses the latest unsaved-record state and falls back to manual review', async () => {
    const cleanProps = props({
      editorHasUnsavedChanges: false,
    });
    enableAutoApproval(cleanProps);
    const approval = unsafeApprovalWithId('approval_dirty_late');
    const approvalRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_dirty_late',
      approvals: [approval],
    });
    let finishTurn: (() => Promise<void>) | undefined;
    const submitApprovals = vi.fn();
    mocks.runtime = {
      runTurn: vi.fn(
        (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) =>
          new Promise<AgentTurnResult>((resolve) => {
            finishTurn = async () => {
              await onEvent?.({
                type: 'approval_required',
                responseId: 'resp_dirty_late',
                approval,
              });
              await onEvent?.({
                type: 'turn_completed',
                result: approvalRequired,
              });
              resolve(approvalRequired);
            };
          }),
      ),
      submitApprovals,
    } as unknown as AgentRuntime;

    const { rerender } = render(<AgentFrame {...cleanProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Update this record');
    });
    rerender(<AgentFrame {...cleanProps} editorHasUnsavedChanges />);
    await act(async () => {
      await finishTurn?.();
    });

    await waitFor(() => {
      const entry = mocks.surfaceProps?.entries.find(
        (candidate) =>
          candidate.kind === 'approval' &&
          candidate.approval.id === 'approval_dirty_late',
      );
      expect(entry?.kind === 'approval' && entry.approval.automatic).toBe(
        false,
      );
      expect(entry?.kind === 'approval' && entry.approval.error).toContain(
        'Save or discard',
      );
    });
    expect(submitApprovals).not.toHaveBeenCalled();
  });

  it('automatically continues a second unsafe approval only after the first settles', async () => {
    const frameProps = props();
    enableAutoApproval(frameProps);
    const firstApproval = unsafeApprovalWithId('approval_chain_one');
    const secondApproval = unsafeApprovalWithId('approval_chain_two');
    const firstRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_chain_one',
      approvals: [firstApproval],
    });
    const secondRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_chain_two',
      approvals: [secondApproval],
    });
    const completed = completedResult({
      responseId: 'resp_chain_completed',
      text: 'Both changes completed.',
    });
    const submitApprovals = vi.fn(
      async (
        args: ContinueApprovalsArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        if (submitApprovals.mock.calls.length === 1) {
          args.unsafeDispatchCallbacks?.beforeDispatch([
            firstApproval.approvalRequestId,
          ]);
          args.unsafeDispatchCallbacks?.confirmed?.([
            firstApproval.approvalRequestId,
          ]);
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_chain_two',
            approval: secondApproval,
          });
          await onEvent?.({ type: 'turn_completed', result: secondRequired });
          return secondRequired;
        }

        args.unsafeDispatchCallbacks?.beforeDispatch([
          secondApproval.approvalRequestId,
        ]);
        args.unsafeDispatchCallbacks?.confirmed?.([
          secondApproval.approvalRequestId,
        ]);
        await onEvent?.({
          type: 'text_delta',
          responseId: 'resp_chain_completed',
          delta: 'Both changes completed.',
        });
        await onEvent?.({ type: 'turn_completed', result: completed });
        return completed;
      },
    );
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_chain_one',
            approval: firstApproval,
          });
          await onEvent?.({ type: 'turn_completed', result: firstRequired });
          return firstRequired;
        },
      ),
      submitApprovals,
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Run the chained update');
    });

    await waitFor(() => expect(submitApprovals).toHaveBeenCalledTimes(2));
    expect(submitApprovals.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ responseId: 'resp_chain_one' }),
    );
    expect(submitApprovals.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ responseId: 'resp_chain_two' }),
    );
  });

  it('recovers a confirmed bundle and unsent next bundle when the frame closes between them', async () => {
    const frameProps = props({
      currentUserId: `unsafe-chain-recovery-user-${testUser}`,
    });
    enableAutoApproval(frameProps);
    const firstApproval = unsafeApprovalWithId('approval_recovery_one');
    const secondApproval = unsafeApprovalWithId('approval_recovery_two');
    const firstRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_recovery_one',
      approvals: [firstApproval],
    });
    const secondRequired = completedResult({
      status: 'approval_required',
      responseId: 'resp_recovery_two',
      approvals: [secondApproval],
    });
    let finishSecond: ((result: AgentTurnResult) => void) | undefined;
    const submitApprovals = vi.fn(
      async (
        args: ContinueApprovalsArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        if (submitApprovals.mock.calls.length === 1) {
          args.unsafeDispatchCallbacks?.beforeDispatch([
            firstApproval.approvalRequestId,
          ]);
          args.unsafeDispatchCallbacks?.confirmed?.([
            firstApproval.approvalRequestId,
          ]);
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_recovery_two',
            approval: secondApproval,
          });
          await onEvent?.({ type: 'turn_completed', result: secondRequired });
          return secondRequired;
        }

        return await new Promise<AgentTurnResult>((resolve) => {
          finishSecond = resolve;
        });
      },
    );
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'approval_required',
            responseId: 'resp_recovery_one',
            approval: firstApproval,
          });
          await onEvent?.({ type: 'turn_completed', result: firstRequired });
          return firstRequired;
        },
      ),
      submitApprovals,
    } as unknown as AgentRuntime;

    const rendered = render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Run both updates');
    });
    await waitFor(() => expect(submitApprovals).toHaveBeenCalledTimes(2));

    const journalStore = createUnsafeDispatchJournalStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    expect(
      journalStore.read()?.operations.map((operation) => operation.state),
    ).toEqual(['confirmed', 'armed']);

    rendered.unmount();
    const replacementRuntime = {
      runTurn: vi.fn(),
      submitApprovals: vi.fn(),
    } as unknown as AgentRuntime;
    mocks.runtime = replacementRuntime;
    render(<AgentFrame {...frameProps} />);

    expect(
      mocks.surfaceProps?.entries.find(
        (entry) =>
          entry.kind === 'message' &&
          entry.role === 'assistant' &&
          entry.content.includes('remaining operations were not sent'),
      ),
    ).toBeTruthy();
    expect(replacementRuntime.runTurn).not.toHaveBeenCalled();
    expect(replacementRuntime.submitApprovals).not.toHaveBeenCalled();

    await act(async () => {
      finishSecond?.(
        completedResult({
          status: 'aborted',
          error: {
            code: 'aborted',
            message: 'The request was cancelled.',
            retryable: false,
          },
        }),
      );
      await Promise.resolve();
    });
  });

  it('keeps a completed answer when native navigation rejects', async () => {
    const navigator = {
      supportsRecordList: true,
      openRecord: vi
        .fn()
        .mockRejectedValue(new Error('Navigation unavailable')),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await mocks.runtimeConfig?.navigation.openRecord({
            itemId: 'item',
            itemTypeId: 'page',
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_complete',
            delta: 'Here is the record.',
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ navigator })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Open the page');
    });

    await waitFor(() => {
      const answer = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'message' && entry.role === 'assistant',
      );
      expect(answer?.kind === 'message' && answer.content).toBe(
        'Here is the record.',
      );
      const activity = mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'activity',
      );
      expect(
        activity?.kind === 'activity' &&
          activity.activities.some((item) => item.status === 'error'),
      ).toBe(true);
    });
  });

  it('resolves and persists native record and asset presentation metadata', async () => {
    const recordMention = {
      type: 'record' as const,
      id: 'record-without-label',
      title: 'Designing for Slow Networks',
      modelId: 'post-model',
      modelApiKey: 'post',
      modelName: 'Post',
      modelEmoji: '📝',
      thumbnailUrl: 'https://www.datocms-assets.com/post.jpg?w=48',
    };
    const assetMention = {
      type: 'asset' as const,
      id: 'hero-upload',
      filename: 'hero.jpg',
      url: 'https://www.datocms-assets.com/hero.jpg',
      thumbnailUrl: 'https://www.datocms-assets.com/hero.jpg?w=300',
      mimeType: 'image/jpeg',
    };
    const resolveRecord = vi.fn(async () => recordMention);
    const resolveAsset = vi.fn(async () => assetMention);
    const mentionHost = {
      currentUser: {
        id: 'editor',
        name: 'Editor',
        email: 'editor@example.com',
        avatarUrl: null,
        userType: 'user',
      },
      projectOwnerId: 'owner',
      projectModels: [
        {
          id: 'post-model',
          apiKey: 'post',
          name: 'Post',
          isBlockModel: false,
        },
      ],
      recordModels: [],
      canMentionFields: false,
      canMentionAssets: true,
      canMentionModels: false,
      loadProjectUsers: async () => [],
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      resolveRecord,
      resolveAsset,
      openUser: () => undefined,
      openModel: () => undefined,
      openLocalFile: async () => undefined,
    } satisfies AgentMentionHost;
    const navigator = {
      supportsRecordList: true,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const frameProps = props({ mentionHost, navigator });
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await mocks.runtimeConfig?.navigation.openRecord({
            itemId: 'record-without-label',
          });
          await mocks.runtimeConfig?.navigation.presentAssets({
            title: 'Hero asset',
            assets: [{ uploadId: 'hero-upload' }],
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_complete',
            delta: 'Here it is.',
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    const rendered = render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Show that record and its image');
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });
    expect(resolveRecord).toHaveBeenCalledWith({
      itemId: 'record-without-label',
    });
    expect(resolveAsset).toHaveBeenCalledWith({ uploadId: 'hero-upload' });
    expect(
      mocks.surfaceProps?.entries.find((entry) => entry.kind === 'records'),
    ).toMatchObject({
      records: [
        {
          itemId: 'record-without-label',
          itemTypeId: 'post-model',
          title: 'Designing for Slow Networks',
          mention: recordMention,
        },
      ],
    });
    expect(
      mocks.surfaceProps?.entries.find((entry) => entry.kind === 'assets'),
    ).toMatchObject({
      assets: [
        {
          uploadId: 'hero-upload',
          title: 'hero.jpg',
          mention: assetMention,
        },
      ],
    });

    const storedAssistant = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    })
      .list()[0]
      ?.messages.find((message) => message.role === 'assistant');
    expect(storedAssistant?.recordResults?.[0]?.records[0]?.mention).toEqual(
      recordMention,
    );
    expect(storedAssistant?.assetResults?.[0]?.assets[0]?.mention).toEqual(
      assetMention,
    );

    rendered.unmount();
    render(<AgentFrame {...frameProps} />);
    expect(
      mocks.surfaceProps?.entries.find((entry) => entry.kind === 'records'),
    ).toMatchObject({
      records: [{ mention: recordMention }],
    });
    expect(
      mocks.surfaceProps?.entries.find((entry) => entry.kind === 'assets'),
    ).toMatchObject({
      assets: [{ mention: assetMention }],
    });
  });

  it('hydrates a restored raw record receipt without breaking response continuity', async () => {
    const itemId = 'HTC4ys4MRiG_gJcyrHMigA';
    const resolvedMention = {
      type: 'record' as const,
      id: itemId,
      title: 'Web development services',
      modelId: 'post-model',
      modelApiKey: 'post',
      modelName: 'Post',
      modelEmoji: '📝',
      thumbnailUrl:
        'https://www.datocms-assets.com/12345/web-development.jpg?w=48',
    };
    const resolveRecord = vi.fn<AgentMentionHost['resolveRecord']>(
      async () => resolvedMention,
    );
    const mentionHost = {
      currentUser: {
        id: 'editor',
        name: 'Editor',
        email: 'editor@example.com',
        avatarUrl: null,
        userType: 'user',
      },
      projectOwnerId: 'owner',
      projectModels: [],
      recordModels: [],
      canMentionFields: false,
      canMentionAssets: false,
      canMentionModels: false,
      loadProjectUsers: async () => [],
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      resolveRecord,
      resolveAsset: async ({ uploadId, label }) => ({
        type: 'asset' as const,
        id: uploadId,
        filename: label || `Asset #${uploadId}`,
        url: '',
        thumbnailUrl: null,
        mimeType: 'application/octet-stream',
      }),
      openUser: () => undefined,
      openModel: () => undefined,
      openLocalFile: async () => undefined,
    } satisfies AgentMentionHost;
    const frameProps = props({
      currentUserId: `legacy-receipt-user-${testUser}`,
      mentionHost,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    const updatedAt = '2026-08-04T10:00:00.000Z';
    store.save({
      id: 'legacy-record-receipt',
      title: 'Find web development content',
      createdAt: updatedAt,
      updatedAt,
      previousResponseId: 'resp_before_restore',
      responseProvider: 'openai',
      responseModel: DEFAULT_CONFIG.model,
      hostContextFingerprint: 'v1:project:before-restore',
      messages: [
        {
          id: 'legacy-user-message',
          role: 'user',
          text: 'Show me the record about web development',
          createdAt: updatedAt,
        },
        {
          id: 'legacy-assistant-message',
          role: 'assistant',
          text: 'Here is the record.',
          createdAt: updatedAt,
          recordResults: [
            {
              id: 'legacy-record-results',
              title: 'Record found',
              records: [{ itemId, title: `Record ${itemId}` }],
            },
          ],
        },
      ],
    });

    const rendered = render(<AgentFrame {...frameProps} />);

    await waitFor(() => {
      expect(resolveRecord).toHaveBeenCalledWith({
        type: 'record',
        itemId,
        label: `Record ${itemId}`,
      });
      expect(
        mocks.surfaceProps?.entries.find((entry) => entry.kind === 'records'),
      ).toMatchObject({
        records: [
          {
            itemId,
            itemTypeId: 'post-model',
            title: 'Web development services',
            mention: resolvedMention,
          },
        ],
      });
    });

    await waitFor(() => {
      const restored = store.get('legacy-record-receipt');
      expect(
        restored?.messages[1]?.recordResults?.[0]?.records[0],
      ).toMatchObject({
        itemId,
        itemTypeId: 'post-model',
        title: 'Web development services',
        mention: resolvedMention,
      });
      expect(restored).toMatchObject({
        updatedAt,
        previousResponseId: 'resp_before_restore',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
        hostContextFingerprint: 'v1:project:before-restore',
      });
    });

    resolveRecord.mockResolvedValueOnce({
      type: 'record',
      id: itemId,
      title: `Record #${itemId}`,
      modelId: 'unknown',
      modelApiKey: '',
      modelName: 'Record',
      modelEmoji: null,
      thumbnailUrl: null,
    });
    rendered.unmount();
    render(<AgentFrame {...frameProps} />);

    await waitFor(() => {
      expect(resolveRecord).toHaveBeenCalledTimes(2);
      expect(
        mocks.surfaceProps?.entries.find((entry) => entry.kind === 'records'),
      ).toMatchObject({
        records: [
          {
            itemId,
            title: 'Web development services',
            mention: resolvedMention,
          },
        ],
      });
      expect(store.get('legacy-record-receipt')).toMatchObject({
        updatedAt,
        previousResponseId: 'resp_before_restore',
      });
    });
  });

  it('hydrates restored field receipts with native field-type metadata', async () => {
    const loadModelFields = vi.fn(async () => [
      {
        apiKey: 'name',
        label: 'Name',
        localized: true,
        fieldPath: 'name',
        displayLabel: 'Name',
        depth: 0,
        availableLocales: ['en'],
        fieldType: 'single_line',
        isBlockContainer: false,
      },
    ]);
    const mentionHost = {
      currentUser: {
        id: 'editor',
        name: 'Editor',
        email: 'editor@example.com',
        avatarUrl: null,
        userType: 'user',
      },
      projectOwnerId: 'owner',
      projectModels: [],
      recordModels: [],
      canMentionFields: true,
      canMentionAssets: false,
      canMentionModels: false,
      loadProjectUsers: async () => [],
      loadModelFields,
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      resolveRecord: async ({ itemId, label }) => ({
        type: 'record' as const,
        id: itemId,
        title: label || `Record #${itemId}`,
        modelId: 'unknown',
        modelApiKey: '',
        modelName: 'Record',
        modelEmoji: null,
        thumbnailUrl: null,
      }),
      resolveAsset: async ({ uploadId, label }) => ({
        type: 'asset' as const,
        id: uploadId,
        filename: label || `Asset #${uploadId}`,
        url: '',
        thumbnailUrl: null,
        mimeType: 'application/octet-stream',
      }),
      openUser: () => undefined,
      openModel: () => undefined,
      openLocalFile: async () => undefined,
    } satisfies AgentMentionHost;
    const frameProps = props({
      currentUserId: `legacy-field-user-${testUser}`,
      scope: { type: 'record', recordId: 'record-1' },
      mentionHost,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    const updatedAt = '2026-08-04T11:00:00.000Z';
    store.save({
      id: 'legacy-field-receipt',
      title: 'Read the current fields',
      createdAt: updatedAt,
      updatedAt,
      messages: [
        {
          id: 'legacy-field-user-message',
          role: 'user',
          text: 'Show the Name field.',
          createdAt: updatedAt,
        },
        {
          id: 'legacy-field-assistant-message',
          role: 'assistant',
          text: 'Here is the field.',
          createdAt: updatedAt,
          fieldResults: [
            {
              id: 'legacy-field-results',
              title: 'Name field',
              fields: [{ fieldPath: 'name', title: 'Name', locale: 'en' }],
            },
          ],
        },
      ],
    });

    render(<AgentFrame {...frameProps} />);

    await waitFor(() => {
      expect(loadModelFields).toHaveBeenCalledOnce();
      expect(
        mocks.surfaceProps?.entries.find((entry) => entry.kind === 'fields'),
      ).toMatchObject({
        fields: [
          {
            fieldPath: 'name',
            title: 'Name',
            locale: 'en',
            mention: {
              type: 'field',
              apiKey: 'name',
              label: 'Name',
              localized: true,
              fieldPath: 'name',
              locale: 'en',
              fieldType: 'single_line',
            },
          },
        ],
      });
    });

    await waitFor(() => {
      const restored = store.get('legacy-field-receipt');
      expect(restored?.updatedAt).toBe(updatedAt);
      expect(
        restored?.messages[1]?.fieldResults?.[0]?.fields[0]?.mention,
      ).toMatchObject({
        type: 'field',
        apiKey: 'name',
        fieldType: 'single_line',
      });
    });
  });

  it('keeps rich restored record and asset metadata when hydration falls back', async () => {
    const recordId = 'HTC4ys4MRiG_gJcyrHMigA';
    const uploadId = 'XyZ9MixedCaseUpload';
    const recordMention = {
      type: 'record' as const,
      id: recordId,
      title: 'Web development services',
      modelId: 'post-model',
      modelApiKey: 'post',
      modelName: 'Post',
      modelEmoji: '📝',
      thumbnailUrl:
        'https://www.datocms-assets.com/12345/web-development.jpg?w=48',
    };
    const assetMention = {
      type: 'asset' as const,
      id: uploadId,
      filename: 'web-development.jpg',
      url: 'https://www.datocms-assets.com/12345/web-development.jpg',
      thumbnailUrl:
        'https://www.datocms-assets.com/12345/web-development.jpg?w=300',
      mimeType: 'image/jpeg',
    };
    const resolveRecord = vi.fn<AgentMentionHost['resolveRecord']>(
      async () => ({
        type: 'record',
        id: recordId,
        title: `Record #${recordId}`,
        modelId: 'unknown',
        modelApiKey: '',
        modelName: 'Record',
        modelEmoji: null,
        thumbnailUrl: null,
      }),
    );
    const resolveAsset = vi.fn<AgentMentionHost['resolveAsset']>(async () => ({
      type: 'asset',
      id: uploadId,
      filename: `Asset #${uploadId}`,
      url: '',
      thumbnailUrl: null,
      mimeType: 'application/octet-stream',
    }));
    const mentionHost = {
      currentUser: {
        id: 'editor',
        name: 'Editor',
        email: 'editor@example.com',
        avatarUrl: null,
        userType: 'user',
      },
      projectOwnerId: 'owner',
      projectModels: [],
      recordModels: [],
      canMentionFields: false,
      canMentionAssets: true,
      canMentionModels: false,
      loadProjectUsers: async () => [],
      selectAsset: async () => undefined,
      selectRecord: async () => undefined,
      resolveRecord,
      resolveAsset,
      openUser: () => undefined,
      openModel: () => undefined,
      openLocalFile: async () => undefined,
    } satisfies AgentMentionHost;
    const frameProps = props({
      currentUserId: `fallback-hydration-user-${testUser}`,
      mentionHost,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    const richUpdatedAt = '2026-08-04T10:00:00.000Z';
    store.save({
      id: 'rich-restored-chat',
      title: 'Rich restored chat',
      createdAt: richUpdatedAt,
      updatedAt: richUpdatedAt,
      messages: [
        {
          id: 'rich-user-message',
          role: 'user',
          text: 'Show the related record and image',
          createdAt: richUpdatedAt,
        },
        {
          id: 'rich-assistant-message',
          role: 'assistant',
          text: 'Here they are.',
          createdAt: richUpdatedAt,
          recordResults: [
            {
              id: 'rich-record-results',
              records: [
                {
                  itemId: recordId,
                  itemTypeId: 'post-model',
                  title: recordMention.title,
                  mention: recordMention,
                },
              ],
            },
          ],
          assetResults: [
            {
              id: 'rich-asset-results',
              assets: [
                {
                  uploadId,
                  title: assetMention.filename,
                  mention: assetMention,
                },
              ],
            },
          ],
        },
      ],
    });
    store.save(
      storedConversation({
        id: 'newer-chat',
        title: 'Newer chat',
        updatedAt: '2026-08-04T11:00:00.000Z',
      }),
    );

    render(<AgentFrame {...frameProps} />);
    const richChat = mocks.surfaceProps?.recentConversations?.find(
      (candidate) => candidate.id === 'rich-restored-chat',
    );
    if (!richChat) throw new Error('Expected the rich restored chat.');
    act(() => {
      mocks.surfaceProps?.onSelectConversation?.(richChat);
    });

    await waitFor(() => {
      expect(resolveRecord).toHaveBeenCalledOnce();
      expect(resolveAsset).toHaveBeenCalledOnce();
      expect(
        mocks.surfaceProps?.entries.find((entry) => entry.kind === 'records'),
      ).toMatchObject({
        records: [
          {
            itemId: recordId,
            itemTypeId: 'post-model',
            title: recordMention.title,
            mention: recordMention,
          },
        ],
      });
      expect(
        mocks.surfaceProps?.entries.find((entry) => entry.kind === 'assets'),
      ).toMatchObject({
        assets: [
          {
            uploadId,
            title: assetMention.filename,
            mention: assetMention,
          },
        ],
      });
    });

    await waitFor(() => {
      const restored = store.get('rich-restored-chat');
      expect(
        restored?.messages[1]?.recordResults?.[0]?.records[0],
      ).toMatchObject({
        title: recordMention.title,
        itemTypeId: recordMention.modelId,
        mention: recordMention,
      });
      expect(restored?.messages[1]?.assetResults?.[0]?.assets[0]).toMatchObject(
        {
          title: assetMention.filename,
          mention: assetMention,
        },
      );
      expect(restored?.updatedAt).toBe(richUpdatedAt);
      expect(store.list().map((conversation) => conversation.id)).toEqual([
        'newer-chat',
        'rich-restored-chat',
      ]);
    });
  });

  it.each<AgentProvider>(['openai', 'anthropic'])(
    'executes only the final queued navigation request for %s',
    async (provider) => {
      const navigator = {
        supportsRecordList: true,
        openRecord: vi.fn().mockResolvedValue(undefined),
        showRecords: vi.fn().mockResolvedValue(undefined),
        openAsset: vi.fn().mockResolvedValue({ deleted: false }),
      };
      const records = [
        { itemId: 'first', itemTypeId: 'page', label: 'First' },
        { itemId: 'second', itemTypeId: 'post', label: 'Second' },
      ];
      let firstNavigationResult: unknown;
      let finalNavigationResult: unknown;
      const result = completedResult({
        responseId:
          provider === 'openai' ? 'resp_navigation' : 'msg_navigation',
      });
      mocks.runtime = {
        runTurn: vi.fn(
          async (
            _args: unknown,
            onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
          ) => {
            firstNavigationResult =
              await mocks.runtimeConfig?.navigation.openRecord({
                itemId: 'superseded',
                itemTypeId: 'page',
              });
            finalNavigationResult =
              await mocks.runtimeConfig?.navigation.showRecords({
                title: 'Final matches',
                records,
              });
            await onEvent?.({ type: 'turn_completed', result });
            return result;
          },
        ),
      } as unknown as AgentRuntime;

      render(
        <AgentFrame
          {...props({
            config: configForProvider(provider),
            navigator,
          })}
        />,
      );
      act(() => {
        mocks.surfaceProps?.onSubmit('Show the final matches');
      });

      await waitFor(() => {
        expect(navigator.showRecords).toHaveBeenCalledOnce();
      });
      expect(navigator.showRecords).toHaveBeenCalledWith({
        title: 'Final matches',
        records,
      });
      expect(navigator.openRecord).not.toHaveBeenCalled();
      expect(firstNavigationResult).toMatchObject({
        queued: true,
        replacedPrevious: false,
        selectionPolicy: 'latest_navigation_wins',
      });
      expect(finalNavigationResult).toMatchObject({
        queued: true,
        replacedPrevious: true,
        selectionPolicy: 'latest_navigation_wins',
      });
    },
  );

  it('turns show_records into clickable results when the surface has no native list', async () => {
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const records = [
      { itemId: 'first', itemTypeId: 'page', label: 'First page' },
      { itemId: 'second', itemTypeId: 'post', label: 'Second post' },
    ];
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          const presentation =
            await mocks.runtimeConfig?.navigation.showRecords({
              title: 'Sidebar matches',
              records,
            });
          expect(presentation).toMatchObject({
            presented: true,
            queued: false,
            count: 2,
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ navigator })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Show the matching records');
    });

    await waitFor(() => {
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) =>
            entry.kind === 'records' && entry.title === 'Sidebar matches',
        ),
      ).toMatchObject({
        records: [
          { itemId: 'first', itemTypeId: 'page', title: 'First page' },
          { itemId: 'second', itemTypeId: 'post', title: 'Second post' },
        ],
      });
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });
    expect(navigator.showRecords).not.toHaveBeenCalled();
    expect(navigator.openRecord).not.toHaveBeenCalled();
  });

  it('presents clickable record results without changing the CMS view', async () => {
    const navigator = {
      supportsRecordList: true,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const frameProps = props({ navigator });
    const records = [
      { itemId: 'first', itemTypeId: 'page', label: 'First page' },
      { itemId: 'second', itemTypeId: 'post', label: 'Second post' },
    ];
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          const presentation =
            await mocks.runtimeConfig?.navigation.presentRecords({
              title: 'Useful records',
              records,
            });
          expect(presentation).toMatchObject({
            presented: true,
            count: 2,
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_complete',
            delta: 'Here are the useful records.',
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    const rendered = render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Give me links to the useful records');
    });

    await waitFor(() => {
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) =>
            entry.kind === 'records' && entry.title === 'Useful records',
        ),
      ).toMatchObject({
        records: [
          { itemId: 'first', itemTypeId: 'page', title: 'First page' },
          { itemId: 'second', itemTypeId: 'post', title: 'Second post' },
        ],
      });
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });
    expect(navigator.openRecord).not.toHaveBeenCalled();
    expect(navigator.showRecords).not.toHaveBeenCalled();

    const receipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records' && entry.title === 'Useful records',
    );
    if (receipt?.kind !== 'records') {
      throw new Error('Expected clickable record results.');
    }
    await act(async () => {
      await mocks.surfaceProps?.onOpenRecord?.(receipt.records[1], receipt.id);
    });
    expect(navigator.openRecord).toHaveBeenCalledWith({
      itemId: 'second',
      itemTypeId: 'post',
      fieldPath: undefined,
    });

    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    expect(
      store.list()[0]?.messages.find((message) => message.role === 'assistant')
        ?.recordResults,
    ).toMatchObject([
      {
        title: 'Useful records',
        records: [
          { itemId: 'first', itemTypeId: 'page', title: 'First page' },
          { itemId: 'second', itemTypeId: 'post', title: 'Second post' },
        ],
      },
    ]);

    rendered.unmount();
    render(<AgentFrame {...frameProps} />);
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'records' && entry.title === 'Useful records',
      ),
    ).toMatchObject({
      records: [
        { itemId: 'first', itemTypeId: 'page', title: 'First page' },
        { itemId: 'second', itemTypeId: 'post', title: 'Second post' },
      ],
    });
  });

  it.each<AgentProvider>(['openai', 'anthropic'])(
    'opens direct user-authored references without a receipt for %s',
    async (provider) => {
      const navigator = {
        supportsRecordList: false,
        openRecord: vi.fn().mockResolvedValue(undefined),
        showRecords: vi.fn().mockResolvedValue(undefined),
        openAsset: vi.fn().mockResolvedValue({ deleted: false }),
      };
      const openCurrentField = vi.fn().mockResolvedValue(undefined);
      render(
        <AgentFrame
          {...props({
            config: configForProvider(provider),
            navigator,
            currentRecord: {
              id: 'current-record',
              modelApiKey: 'page',
              hasUnsavedChanges: false,
            },
            scope: { type: 'record', recordId: 'current-record' },
            openCurrentField,
          })}
        />,
      );

      await act(async () => {
        await mocks.surfaceProps?.onOpenRecord?.({
          itemId: 'record-1',
          itemTypeId: 'model-1',
          title: 'Homepage',
        });
      });
      expect(navigator.openRecord).toHaveBeenCalledWith({
        itemId: 'record-1',
        itemTypeId: 'model-1',
        fieldPath: undefined,
      });

      await act(async () => {
        await mocks.surfaceProps?.onOpenField?.({
          fieldPath: 'title',
          title: 'Title',
          locale: 'en',
        });
      });
      expect(openCurrentField).toHaveBeenCalledWith({
        fieldPath: 'title',
        label: 'Title',
        locale: 'en',
      });

      await act(async () => {
        await mocks.surfaceProps?.onOpenAsset?.({
          uploadId: 'upload-1',
          title: 'Hero.jpg',
        });
      });
      expect(navigator.openAsset).toHaveBeenCalledWith({
        uploadId: 'upload-1',
        label: 'Hero.jpg',
      });
    },
  );

  it('shows record receipt navigation errors without rejecting the click', async () => {
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn().mockRejectedValue(new Error('Access denied.')),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await mocks.runtimeConfig?.navigation.presentRecords({
            title: 'Protected record',
            records: [{ itemId: 'protected', label: 'Protected record' }],
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ navigator })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Show the protected record');
    });
    await waitFor(() => {
      expect(
        mocks.surfaceProps?.entries.some(
          (entry) =>
            entry.kind === 'records' && entry.title === 'Protected record',
        ),
      ).toBe(true);
    });

    const receipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records' && entry.title === 'Protected record',
    );
    if (receipt?.kind !== 'records') {
      throw new Error('Expected clickable record results.');
    }

    await act(async () => {
      await mocks.surfaceProps?.onOpenRecord?.(receipt.records[0], receipt.id);
    });

    expect(navigator.openRecord).toHaveBeenCalledWith({
      itemId: 'protected',
      itemTypeId: undefined,
      fieldPath: undefined,
    });
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'records' && entry.id === receipt.id,
      ),
    ).toMatchObject({
      error: 'Could not open this record. Access denied.',
    });
  });

  it('presents, opens, and restores verified field and asset receipts', async () => {
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: true }),
    };
    const prepareCurrentFieldReferences = vi.fn(async () => ({
      title: 'Relevant fields',
      fields: [
        { fieldPath: 'title', label: 'Title', locale: 'en' },
        { fieldPath: 'seo', label: 'SEO' },
      ],
    }));
    const readCurrentRecordLiveFormState = vi.fn().mockResolvedValue({
      source: 'current_record_browser_form_state',
      persistence: 'may_be_unsaved',
      savedOrPublishedStateVerified: false,
      caveat:
        'This data comes from the current browser form and may be unsaved.',
      fields: [{ fieldPath: 'title', summary: '"Draft title"' }],
    });
    const openCurrentField = vi.fn().mockResolvedValue(undefined);
    const frameProps = props({
      navigator,
      currentRecord: {
        id: 'record-1',
        modelApiKey: 'page',
        hasUnsavedChanges: true,
      },
      scope: { type: 'record', recordId: 'record-1' },
      prepareCurrentFieldReferences,
      readCurrentRecordLiveFormState,
      openCurrentField,
    });
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await expect(
            mocks.runtimeConfig?.navigation.presentFields?.({
              title: 'Fields from the model',
              fields: [
                { fieldPath: 'title', label: 'Draft title' },
                { fieldPath: 'seo', label: 'SEO' },
              ],
            }),
          ).resolves.toMatchObject({ presented: true, count: 2 });
          await expect(
            mocks.runtimeConfig?.navigation.readCurrentRecordLiveFormState?.({
              fields: [{ fieldApiKey: 'title', locale: 'en' }],
            }),
          ).resolves.toMatchObject({
            source: 'current_record_browser_form_state',
            persistence: 'may_be_unsaved',
          });
          await expect(
            mocks.runtimeConfig?.navigation.presentAssets({
              title: 'Referenced assets',
              assets: [{ uploadId: 'upload-1', label: 'Hero.jpg' }],
            }),
          ).resolves.toMatchObject({ presented: true, count: 1 });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_complete',
            delta: 'Here are the relevant references.',
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    const rendered = render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Show the fields and hero image');
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) =>
            entry.kind === 'fields' && entry.title === 'Relevant fields',
        ),
      ).toMatchObject({
        fields: [
          { fieldPath: 'title', title: 'Title', locale: 'en' },
          { fieldPath: 'seo', title: 'SEO' },
        ],
      });
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) =>
            entry.kind === 'assets' && entry.title === 'Referenced assets',
        ),
      ).toMatchObject({
        assets: [{ uploadId: 'upload-1', title: 'Hero.jpg' }],
      });
    });

    const fieldReceipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'fields',
    );
    const assetReceipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'assets',
    );
    if (fieldReceipt?.kind !== 'fields' || assetReceipt?.kind !== 'assets') {
      throw new Error('Expected field and asset receipts.');
    }

    await act(async () => {
      await mocks.surfaceProps?.onOpenField?.(
        fieldReceipt.fields[0],
        fieldReceipt.id,
      );
    });
    expect(openCurrentField).toHaveBeenCalledWith({
      fieldPath: 'title',
      label: 'Title',
      locale: 'en',
    });

    await act(async () => {
      await mocks.surfaceProps?.onOpenAsset?.(
        assetReceipt.assets[0],
        assetReceipt.id,
      );
    });
    expect(navigator.openAsset).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      label: 'Hero.jpg',
    });
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'assets' && entry.id === assetReceipt.id,
      ),
    ).toMatchObject({
      assets: [{ uploadId: 'upload-1', title: 'Hero.jpg', deleted: true }],
    });

    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    const assistant = store
      .list()[0]
      ?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.fieldResults).toMatchObject([
      {
        title: 'Relevant fields',
        fields: [
          { fieldPath: 'title', title: 'Title', locale: 'en' },
          { fieldPath: 'seo', title: 'SEO' },
        ],
      },
    ]);
    expect(assistant?.assetResults).toMatchObject([
      {
        title: 'Referenced assets',
        assets: [{ uploadId: 'upload-1', title: 'Hero.jpg', deleted: true }],
      },
    ]);

    rendered.unmount();
    render(<AgentFrame {...frameProps} />);
    expect(
      mocks.surfaceProps?.entries.find((entry) => entry.kind === 'assets'),
    ).toMatchObject({
      assets: [{ uploadId: 'upload-1', title: 'Hero.jpg', deleted: true }],
    });
  });

  it('allows only one native receipt action while an asset modal is open', async () => {
    let finishAsset: ((result: { deleted: boolean }) => void) | undefined;
    const assetModal = new Promise<{ deleted: boolean }>((resolve) => {
      finishAsset = resolve;
    });
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn().mockResolvedValue(undefined),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn(() => assetModal),
    };
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await mocks.runtimeConfig?.navigation.presentRecords({
            title: 'Record',
            records: [{ itemId: 'record-1', label: 'Record' }],
          });
          await mocks.runtimeConfig?.navigation.presentAssets({
            title: 'Asset',
            assets: [{ uploadId: 'upload-1', label: 'Hero.jpg' }],
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ navigator })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Show both');
    });
    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });

    const recordReceipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records',
    );
    const assetReceipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'assets',
    );
    if (recordReceipt?.kind !== 'records' || assetReceipt?.kind !== 'assets') {
      throw new Error('Expected record and asset receipts.');
    }

    let opening: void | Promise<void>;
    act(() => {
      opening = mocks.surfaceProps?.onOpenAsset?.(
        assetReceipt.assets[0],
        assetReceipt.id,
      );
    });
    expect(mocks.surfaceProps?.hostActionPending).toBe(true);

    await act(async () => {
      await mocks.surfaceProps?.onOpenRecord?.(
        recordReceipt.records[0],
        recordReceipt.id,
      );
    });
    expect(navigator.openRecord).not.toHaveBeenCalled();

    finishAsset?.({ deleted: false });
    await act(async () => {
      await opening;
    });
    expect(mocks.surfaceProps?.hostActionPending).toBe(false);
  });

  it('prevents competing modal requests while a record receipt is opening', async () => {
    let finishOpening: (() => void) | undefined;
    const opening = new Promise<void>((resolve) => {
      finishOpening = resolve;
    });
    const navigator = {
      supportsRecordList: false,
      openRecord: vi.fn(() => opening),
      showRecords: vi.fn().mockResolvedValue(undefined),
      openAsset: vi.fn().mockResolvedValue({ deleted: false }),
    };
    const result = completedResult();
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await mocks.runtimeConfig?.navigation.presentRecords({
            title: 'Modal target',
            records: [{ itemId: 'target', label: 'Modal target' }],
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_complete',
            delta: 'I found the record.',
          });
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ navigator })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Find the modal target');
    });
    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });

    const receipt = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'records' && entry.title === 'Modal target',
    );
    if (receipt?.kind !== 'records') {
      throw new Error('Expected clickable record results.');
    }

    let firstClick: void | Promise<void>;
    act(() => {
      firstClick = mocks.surfaceProps?.onOpenRecord?.(
        receipt.records[0],
        receipt.id,
      );
      void mocks.surfaceProps?.onOpenRecord?.(receipt.records[0], receipt.id);
    });

    expect(navigator.openRecord).toHaveBeenCalledOnce();
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'records' && entry.id === receipt.id,
      ),
    ).toMatchObject({ opening: true });

    finishOpening?.();
    await act(async () => {
      await firstClick;
    });
    expect(
      mocks.surfaceProps?.entries.find(
        (entry) => entry.kind === 'records' && entry.id === receipt.id,
      ),
    ).toMatchObject({ opening: false, error: undefined });
  });

  it.each<AgentProvider>(['openai', 'anthropic'])(
    'persists tool-only record receipts for %s without replaying a blank assistant turn',
    async (provider) => {
      const frameProps = props({ config: configForProvider(provider) });
      const result = completedResult({
        responseId: provider === 'openai' ? 'resp_tool_only' : 'msg_tool_only',
      });
      mocks.runtime = {
        runTurn: vi.fn(
          async (
            _args: unknown,
            onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
          ) => {
            await mocks.runtimeConfig?.navigation.presentRecords({
              title: 'Tool-only result',
              records: [{ itemId: 'tool-only', label: 'Tool-only record' }],
            });
            await onEvent?.({ type: 'turn_completed', result });
            return result;
          },
        ),
      } as unknown as AgentRuntime;

      const rendered = render(<AgentFrame {...frameProps} />);
      act(() => {
        mocks.surfaceProps?.onSubmit('Find the tool-only record');
      });
      await waitFor(() => {
        expect(mocks.surfaceProps?.isRunning).toBe(false);
      });

      const store = createConversationStore({
        pluginId: frameProps.pluginId,
        siteId: frameProps.siteId,
        environment: frameProps.environment,
        currentUserId: frameProps.currentUserId,
        scope: frameProps.scope,
      });
      expect(
        store
          .list()[0]
          ?.messages.find((message) => message.role === 'assistant'),
      ).toMatchObject({
        text: '',
        recordResults: [
          {
            title: 'Tool-only result',
            records: [{ itemId: 'tool-only', title: 'Tool-only record' }],
          },
        ],
      });

      rendered.unmount();
      render(<AgentFrame {...frameProps} />);
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) =>
            entry.kind === 'records' && entry.title === 'Tool-only result',
        ),
      ).toMatchObject({
        records: [{ itemId: 'tool-only', title: 'Tool-only record' }],
      });

      mocks.runtime = {
        runTurn: vi.fn(async () => completedResult()),
      } as unknown as AgentRuntime;
      act(() => {
        mocks.surfaceProps?.onSubmit('Continue without replaying blank text');
      });
      await waitFor(() => {
        expect(mocks.runtime?.runTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            history: [
              {
                role: 'user',
                text: 'Find the tool-only record',
              },
            ],
          }),
          expect.any(Function),
        );
      });
    },
  );

  it('switches between chats from the current path and resumes the selected response', async () => {
    const frameProps = props({ currentUserId: `history-user-${testUser}` });
    enableAutoApproval(frameProps);
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'older',
        title: 'Older project chat',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_older',
      }),
    );
    store.save(
      storedConversation({
        id: 'latest',
        title: 'Latest project chat',
        updatedAt: '2026-07-29T11:00:00.000Z',
        previousResponseId: 'resp_latest',
      }),
    );
    const otherPathStore = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: { type: 'record', recordId: 'another-path' },
    });
    otherPathStore.save(
      storedConversation({
        id: 'other-path',
        title: 'Other path chat',
        updatedAt: '2026-07-29T12:00:00.000Z',
      }),
    );
    const completed = completedResult({ responseId: 'resp_continued' });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({ type: 'turn_completed', result: completed });
          return completed;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);

    expect(mocks.surfaceProps?.autoApproveEnabled).toBe(true);
    expect(
      mocks.surfaceProps?.recentConversations?.map((chat) => chat.id),
    ).toEqual(['latest', 'older']);
    expect(
      mocks.surfaceProps?.recentConversations?.find(
        (chat) => chat.id === 'latest',
      )?.isCurrent,
    ).toBe(true);

    const older = mocks.surfaceProps?.recentConversations?.find(
      (chat) => chat.id === 'older',
    );
    act(() => {
      if (older) {
        mocks.surfaceProps?.onSelectConversation?.(older);
      }
    });

    await waitFor(() => {
      expect(
        mocks.surfaceProps?.entries.some(
          (entry) =>
            entry.kind === 'message' && entry.content === 'Older project chat',
        ),
      ).toBe(true);
      expect(
        mocks.surfaceProps?.recentConversations?.find(
          (chat) => chat.id === 'older',
        )?.isCurrent,
      ).toBe(true);
      expect(mocks.surfaceProps?.autoApproveEnabled).toBe(true);
    });

    act(() => {
      mocks.surfaceProps?.onSubmit('Continue this chat');
    });

    await waitFor(() => {
      expect(mocks.runtime?.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({ previousResponseId: 'resp_older' }),
        expect.any(Function),
      );
    });
  });

  it('blocks history changes immediately after a turn starts', async () => {
    const frameProps = props({ currentUserId: `active-turn-user-${testUser}` });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'older',
        title: 'Older project chat',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_older',
      }),
    );
    store.save(
      storedConversation({
        id: 'latest',
        title: 'Latest project chat',
        updatedAt: '2026-07-29T11:00:00.000Z',
        previousResponseId: 'resp_latest',
      }),
    );

    const completed = completedResult({ responseId: 'resp_active' });
    let completeTurn: (() => Promise<void>) | undefined;
    mocks.runtime = {
      runTurn: vi.fn(
        (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) =>
          new Promise<AgentTurnResult>((resolve) => {
            completeTurn = async () => {
              await onEvent?.({ type: 'turn_completed', result: completed });
              resolve(completed);
            };
          }),
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    const older = mocks.surfaceProps?.recentConversations?.find(
      (chat) => chat.id === 'older',
    );
    if (!older) {
      throw new Error('Expected the older conversation.');
    }

    act(() => {
      mocks.surfaceProps?.onSubmit('Keep this turn active');
    });

    let selectResult: boolean | undefined | Promise<boolean | undefined>;
    let newChatResult: boolean | undefined | Promise<boolean | undefined>;
    act(() => {
      selectResult = mocks.surfaceProps?.onSelectConversation?.(older);
      newChatResult = mocks.surfaceProps?.onStartNewChat?.();
    });

    expect(selectResult).toBe(false);
    expect(newChatResult).toBe(false);
    expect(
      mocks.surfaceProps?.recentConversations?.find((chat) => chat.isCurrent)
        ?.id,
    ).toBe('latest');

    await act(async () => {
      await completeTurn?.();
    });
  });

  it('keeps a new empty chat out of history and prunes to three after its first turn', async () => {
    const frameProps = props({ currentUserId: `new-chat-user-${testUser}` });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    for (const [index, id] of ['oldest', 'middle', 'latest'].entries()) {
      store.save(
        storedConversation({
          id,
          title: `${id} chat`,
          updatedAt: `2026-07-29T1${index}:00:00.000Z`,
        }),
      );
    }
    const completed = completedResult({ responseId: 'resp_fourth' });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_fourth',
            delta: 'Fourth answer',
          });
          await onEvent?.({ type: 'turn_completed', result: completed });
          return completed;
        },
      ),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    expect(mocks.surfaceProps?.recentConversations).toHaveLength(3);

    act(() => {
      mocks.surfaceProps?.onStartNewChat?.();
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.entries).toEqual([]);
      expect(
        mocks.surfaceProps?.recentConversations?.some((chat) => chat.isCurrent),
      ).toBe(false);
    });
    expect(store.list().map((chat) => chat.id)).toEqual([
      'latest',
      'middle',
      'oldest',
    ]);

    act(() => {
      mocks.surfaceProps?.onSubmit('Fourth chat');
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.recentConversations).toHaveLength(3);
      expect(
        mocks.surfaceProps?.recentConversations?.some(
          (chat) => chat.title === 'Fourth chat' && chat.isCurrent,
        ),
      ).toBe(true);
    });
    expect(store.list()).toHaveLength(3);
    expect(store.list().some((chat) => chat.id === 'oldest')).toBe(false);
  });

  it('retries an explicitly retryable safe failure with one prompt and a fresh provider chain', async () => {
    const loadHostContext = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'surface=standalone\nproject_map|version=failed',
        fingerprint: 'v1:project:failed',
      })
      .mockResolvedValueOnce({
        text: 'surface=standalone\nproject_map|version=retry',
        fingerprint: 'v1:project:retry',
      });
    const frameProps = props({
      currentUserId: `manual-retry-user-${testUser}`,
      loadHostContext,
    });
    seedDatoConnection(frameProps);
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'manual-retry-chain',
        title: 'Earlier question',
        updatedAt: '2026-07-30T10:00:00.000Z',
        previousResponseId: 'resp_before_manual_retry',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const failedError = {
      code: 'api_error' as const,
      message: 'The provider was temporarily unavailable.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_retryable_failure',
      text: 'Partial answer',
      error: failedError,
    });
    const completed = completedResult({
      responseId: 'resp_manual_retry',
      text: 'Recovered answer',
    });
    let invocation = 0;
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        invocation += 1;
        if (invocation === 1) {
          await onEvent?.({
            type: 'activity',
            responseId: 'resp_retryable_failure',
            activity: {
              id: 'read-before-failure',
              kind: 'mcp_tool',
              status: 'completed',
              label: 'Reading CMS content',
              arguments: { query: 'launch' },
            },
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_retryable_failure',
            delta: 'Partial answer',
          });
          await onEvent?.({
            type: 'error',
            responseId: 'resp_retryable_failure',
            error: failedError,
          });
          await onEvent?.({ type: 'turn_completed', result: failed });
          return failed;
        }

        await onEvent?.({
          type: 'text_delta',
          responseId: 'resp_manual_retry',
          delta: 'Recovered answer',
        });
        await onEvent?.({ type: 'turn_completed', result: completed });
        return completed;
      },
    );
    mocks.runtime = {
      runTurn,
      dispose: vi.fn(),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Find the launch record');
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) => entry.kind === 'message' && entry.role === 'assistant',
        ),
      ).toMatchObject({
        content: 'Partial answer',
        failure: { retryable: true },
      });
    });

    const failedEntry = mocks.surfaceProps?.entries.find(
      (entry) => entry.kind === 'message' && entry.role === 'assistant',
    );
    if (failedEntry?.kind !== 'message' || !failedEntry.failure) {
      throw new Error('Expected a retryable terminal failure.');
    }
    const failureId = failedEntry.failure.id;

    await act(async () => {
      await mocks.surfaceProps?.onRetryFailedTurn?.(failureId);
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(loadHostContext).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        history: [{ role: 'user', text: 'Earlier question' }],
        previousResponseId: 'resp_before_manual_retry',
      }),
    );
    expect(runTurn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        message: 'Find the launch record',
        history: [{ role: 'user', text: 'Earlier question' }],
        previousResponseId: undefined,
        injectHostContext: true,
      }),
    );
    expect(mocks.runtimeConfigs).toHaveLength(2);
    expect(mocks.runtimeConfigs[1]?.hostContext).toContain('version=retry');

    await waitFor(() => {
      const messages =
        mocks.surfaceProps?.entries.filter(
          (entry) => entry.kind === 'message',
        ) ?? [];
      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Earlier question',
      });
      expect(messages[1]).toMatchObject({
        role: 'user',
        content: 'Find the launch record',
      });
      expect(messages[2]).toMatchObject({
        role: 'assistant',
        content: 'Recovered answer',
      });
      expect(messages[2]).not.toHaveProperty('failure');
    });

    expect(
      store.list()[0]?.messages.map(({ role, text }) => ({ role, text })),
    ).toEqual([
      { role: 'user', text: 'Earlier question' },
      { role: 'user', text: 'Find the launch record' },
      { role: 'assistant', text: 'Recovered answer' },
    ]);
  });

  it('claims a retry candidate synchronously so repeated clicks start one turn', async () => {
    const failure = {
      code: 'api_error' as const,
      message: 'Try this request again.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_double_click_failure',
      error: failure,
    });
    const recovered = completedResult({
      responseId: 'resp_double_click_recovered',
    });
    let releaseRetry: (() => void) | undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let invocation = 0;
    const runTurn = vi.fn(
      async (
        _args: unknown,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        invocation += 1;
        if (invocation === 1) {
          await onEvent?.({
            type: 'error',
            responseId: 'resp_double_click_failure',
            error: failure,
          });
          await onEvent?.({ type: 'turn_completed', result: failed });
          return failed;
        }

        await retryGate;
        await onEvent?.({ type: 'turn_completed', result: recovered });
        return recovered;
      },
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    const frameProps = props({
      currentUserId: `double-click-retry-user-${testUser}`,
    });
    seedDatoConnection(frameProps);
    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Retry only once');
    });
    await waitFor(() => expect(mocks.surfaceProps?.isRunning).toBe(false));

    const failedEntry = mocks.surfaceProps?.entries.find(
      (entry) =>
        entry.kind === 'message' &&
        entry.role === 'assistant' &&
        entry.failure?.retryable,
    );
    if (failedEntry?.kind !== 'message' || !failedEntry.failure) {
      throw new Error('Expected a retryable failure.');
    }

    let firstRetry: void | Promise<void> | undefined;
    let secondRetry: void | Promise<void> | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    act(() => {
      firstRetry = mocks.surfaceProps?.onRetryFailedTurn?.(
        failedEntry.failure?.id ?? '',
      );
      secondRetry = mocks.surfaceProps?.onRetryFailedTurn?.(
        failedEntry.failure?.id ?? '',
      );
      mocks.surfaceProps?.onDisconnectDatoCms?.();
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.surfaceProps?.connection.datoCmsStatus).toBe('connected');

    await act(async () => {
      releaseRetry?.();
      await retryGate;
      await Promise.all([firstRetry, secondRetry]);
    });
  });

  it('copies full failure diagnostics including raw credentials, prompt, context, and tool arguments', async () => {
    const frameProps = props({
      currentUserId: `diagnostics-user-${testUser}`,
      loadHostContext: vi.fn(async () => ({
        text: 'surface=standalone\nrecord|id=record-secret',
        fingerprint: 'v1:record:record-secret',
      })),
      currentRecord: {
        id: 'record-secret',
        modelApiKey: 'article',
        fieldPath: 'content',
      },
      config: {
        ...DEFAULT_CONFIG,
        openAiApiKey: 'sk-diagnostic-secret',
        additionalInstructions: 'Editorial secret instruction',
      },
    });
    createCredentialStore({
      siteId: frameProps.siteId,
      currentUserId: frameProps.currentUserId,
    }).save(
      createOAuthCredentials(
        {
          clientId: 'diagnostic-client',
          clientIdIssuedAt: 1_700_000_000,
          redirectUri: 'https://example.test/oauth/callback',
        },
        {
          accessToken: 'diagnostic-oauth-secret',
          tokenType: 'Bearer',
          obtainedAt: 1_700_000_000,
        },
      ),
      { remember: true },
    );
    const failure = {
      code: 'api_error' as const,
      message: 'Provider diagnostic failure.',
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_diagnostics',
      error: failure,
    });
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_diagnostics',
            delta: 'Secret ',
          });
          await onEvent?.({
            type: 'text_delta',
            responseId: 'resp_diagnostics',
            delta: 'answer.',
          });
          await onEvent?.({
            type: 'activity',
            responseId: 'resp_diagnostics',
            activity: {
              id: 'diagnostic-tool',
              kind: 'mcp_tool',
              status: 'failed',
              label: 'Reading CMS content',
              toolName: 'upsert_and_execute_safe_script',
              arguments: {
                site_id: 'site',
                body: {
                  content: 'console.log("raw diagnostic content")',
                },
              },
              output: '{"raw":"diagnostic tool output"}',
              error: 'Raw tool error',
            },
          });
          await onEvent?.({
            type: 'error',
            responseId: 'resp_diagnostics',
            error: failure,
          });
          await onEvent?.({ type: 'turn_completed', result: failed });
          return failed;
        },
      ),
    } as unknown as AgentRuntime;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit(
        'Find the private record with all of its content',
      );
    });
    await waitFor(() => expect(mocks.surfaceProps?.isRunning).toBe(false));

    const failedEntry = mocks.surfaceProps?.entries.find(
      (entry) =>
        entry.kind === 'message' && entry.role === 'assistant' && entry.failure,
    );
    if (failedEntry?.kind !== 'message' || !failedEntry.failure) {
      throw new Error('Expected terminal failure diagnostics.');
    }

    await act(async () => {
      await mocks.surfaceProps?.onCopyFailureDiagnostics?.(
        failedEntry.failure?.id ?? '',
      );
    });

    expect(writeText).toHaveBeenCalledOnce();
    const diagnostics = JSON.parse(String(writeText.mock.calls[0]?.[0]));
    expect(diagnostics.configuration.openAiApiKey).toBe('sk-diagnostic-secret');
    expect(diagnostics.configuration.activeApiKey).toBe('sk-diagnostic-secret');
    expect(diagnostics.oauthCredentials.token.accessToken).toBe(
      'diagnostic-oauth-secret',
    );
    expect(diagnostics.turn.message).toBe(
      'Find the private record with all of its content',
    );
    expect(diagnostics.turn.hostContexts[0].text).toContain('record-secret');
    expect(diagnostics.turn.systemPrompt).toContain(
      'Editorial secret instruction',
    );
    expect(diagnostics.turn.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'activity',
            activity: expect.objectContaining({
              arguments: {
                site_id: 'site',
                body: {
                  content: 'console.log("raw diagnostic content")',
                },
              },
              output: '{"raw":"diagnostic tool output"}',
            }),
          }),
        }),
      ]),
    );
    expect(
      diagnostics.turn.events.some(
        (snapshot: { event?: { type?: string } }) =>
          snapshot.event?.type === 'text_delta',
      ),
    ).toBe(false);
    expect(diagnostics.turn.textDeltaCount).toBe(2);
    expect(diagnostics.turn.textDeltaCharacters).toBe(14);
    expect(diagnostics.project.currentRecord.id).toBe('record-secret');
    expect(diagnostics.turn.completionResult.error.message).toBe(
      'Provider diagnostic failure.',
    );
  });

  it('offers diagnostics but never retry when the runtime throws without an explicit retryable result', async () => {
    mocks.runtime = {
      runTurn: vi
        .fn()
        .mockRejectedValue(new Error('The provider connection broke.')),
    } as unknown as AgentRuntime;

    render(<AgentFrame {...props()} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Describe the project');
    });

    await waitFor(() => {
      expect(mocks.surfaceProps?.isRunning).toBe(false);
      expect(
        mocks.surfaceProps?.entries.find(
          (entry) => entry.kind === 'message' && entry.role === 'assistant',
        ),
      ).toMatchObject({
        error: 'The provider connection broke.',
        interrupted: true,
        failure: { retryable: false },
      });
    });
    expect(mocks.surfaceProps?.onCopyFailureDiagnostics).toBeTypeOf('function');
    expect(mocks.surfaceProps?.onRetryFailedTurn).toBeTypeOf('function');
  });

  it('deduplicates repeated activity snapshots and bounds total diagnostic tool output', async () => {
    const failure = {
      code: 'api_error' as const,
      message: 'Failure after large tool results.',
      retryable: false,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_large_diagnostics',
      error: failure,
    });
    const largeOutput = 'x'.repeat(240_000);
    mocks.runtime = {
      runTurn: vi.fn(
        async (
          _args: unknown,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          for (const [id, output] of [
            ['duplicate', 'initial'],
            ['duplicate', largeOutput],
            ['second', largeOutput],
            ['third', largeOutput],
          ]) {
            // biome-ignore lint/performance/noAwaitInLoops: Ordered duplicate snapshots exercise the recorder's replacement and aggregate cap.
            await onEvent?.({
              type: 'activity',
              responseId: 'resp_large_diagnostics',
              activity: {
                id,
                kind: 'mcp_tool',
                status: 'completed',
                label: 'Reading CMS content',
                output,
              },
            });
          }
          await onEvent?.({
            type: 'error',
            responseId: 'resp_large_diagnostics',
            error: failure,
          });
          await onEvent?.({ type: 'turn_completed', result: failed });
          return failed;
        },
      ),
    } as unknown as AgentRuntime;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<AgentFrame {...props()} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Run a large diagnostic read');
    });
    await waitFor(() => expect(mocks.surfaceProps?.isRunning).toBe(false));
    const failedEntry = mocks.surfaceProps?.entries.find(
      (entry) =>
        entry.kind === 'message' && entry.role === 'assistant' && entry.failure,
    );
    if (failedEntry?.kind !== 'message' || !failedEntry.failure) {
      throw new Error('Expected failure diagnostics.');
    }

    await act(async () => {
      await mocks.surfaceProps?.onCopyFailureDiagnostics?.(
        failedEntry.failure?.id ?? '',
      );
    });

    const diagnostics = JSON.parse(String(writeText.mock.calls[0]?.[0]));
    const activities = diagnostics.turn.events.filter(
      (snapshot: { event?: { type?: string } }) =>
        snapshot.event?.type === 'activity',
    );
    expect(
      activities.filter(
        (snapshot: { event: { activity: { id: string } } }) =>
          snapshot.event.activity.id === 'duplicate',
      ),
    ).toHaveLength(1);
    const totalOutputCharacters = activities.reduce(
      (
        total: number,
        snapshot: { event: { activity: { output?: unknown } } },
      ) =>
        total +
        (typeof snapshot.event.activity.output === 'string'
          ? snapshot.event.activity.output.length
          : 0),
      0,
    );
    expect(totalOutputCharacters).toBeLessThanOrEqual(500_000);
    expect(diagnostics.turn.diagnosticEventOutputCharacters).toBe(
      totalOutputCharacters,
    );
  });

  it('treats Stop as cancellation and never rebuilds a stale response chain', async () => {
    const frameProps = props({
      currentUserId: `stopped-stale-chain-user-${testUser}`,
    });
    const store = createConversationStore({
      pluginId: frameProps.pluginId,
      siteId: frameProps.siteId,
      environment: frameProps.environment,
      currentUserId: frameProps.currentUserId,
      scope: frameProps.scope,
    });
    store.save(
      storedConversation({
        id: 'stopped-stale-chain',
        title: 'Earlier question',
        updatedAt: '2026-07-29T10:00:00.000Z',
        previousResponseId: 'resp_before_stop',
        responseProvider: 'openai',
        responseModel: DEFAULT_CONFIG.model,
      }),
    );
    const failure = {
      code: 'api_error' as const,
      message: "No response found with id 'resp_before_stop'.",
      retryable: true,
    };
    const failed = completedResult({
      status: 'failed',
      responseId: 'resp_after_stop',
      error: failure,
    });
    const runTurn = vi.fn(
      (
        args: { signal?: AbortSignal },
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) =>
        new Promise<AgentTurnResult>((resolve) => {
          args.signal?.addEventListener(
            'abort',
            () => {
              void (async () => {
                await onEvent?.({
                  type: 'error',
                  responseId: 'resp_after_stop',
                  error: failure,
                });
                await onEvent?.({ type: 'turn_completed', result: failed });
                resolve(failed);
              })();
            },
            { once: true },
          );
        }),
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    render(<AgentFrame {...frameProps} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Start a long read');
    });
    await waitFor(() => expect(mocks.surfaceProps?.isRunning).toBe(true));
    act(() => {
      mocks.surfaceProps?.onStop?.();
    });

    await waitFor(() => expect(mocks.surfaceProps?.isRunning).toBe(false));
    expect(runTurn).toHaveBeenCalledOnce();
    expect(runTurn.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ previousResponseId: 'resp_before_stop' }),
    );
    expect(mocks.runtimeConfigs).toHaveLength(1);
    expect(
      mocks.surfaceProps?.entries.some(
        (entry) => entry.kind === 'message' && Boolean(entry.failure),
      ),
    ).toBe(false);
    expect(
      mocks.surfaceProps?.entries.find((entry) => entry.kind === 'activity'),
    ).toMatchObject({ phase: 'cancelled' });
  });

  it('passes the exact session File to the runtime for a current attachment', async () => {
    const file = new File(['current attachment bytes'], 'brief.pdf', {
      type: 'application/pdf',
      lastModified: 1_786_000_000_000,
    });
    const mention = registerLocalFile(file);
    const result = completedResult({ responseId: 'resp_file_current' });
    const runTurn = vi.fn(
      async (
        _args: AgentTurnArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        await onEvent?.({ type: 'turn_completed', result });
        return result;
      },
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    render(<AgentFrame {...props()} />);
    act(() => {
      mocks.surfaceProps?.onSubmit(localFileSubmission(mention));
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledOnce());
    const turn = runTurn.mock.calls[0]?.[0];
    expect(turn?.attachments).toEqual([
      {
        id: mention.id,
        filename: mention.filename,
        mimeType: mention.mimeType,
        size: mention.size,
        lastModified: mention.lastModified,
        file,
      },
    ]);
    expect(turn?.attachments?.[0]?.file).toBe(file);
    expect(turn?.message).toContain('"bytesAvailable":true');
  });

  it('retains session-owned file bytes in later provider history', async () => {
    const file = new File(['retained attachment bytes'], 'research.pdf', {
      type: 'application/pdf',
      lastModified: 1_786_000_001_000,
    });
    const mention = registerLocalFile(file);
    let response = 0;
    const runTurn = vi.fn(
      async (
        _args: AgentTurnArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        response += 1;
        const result = completedResult({
          responseId: `resp_history_${response}`,
        });
        await onEvent?.({ type: 'turn_completed', result });
        return result;
      },
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    render(
      <AgentFrame {...props({ config: configForProvider('anthropic') })} />,
    );
    act(() => {
      mocks.surfaceProps?.onSubmit(localFileSubmission(mention));
    });
    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledTimes(1);
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });

    act(() => {
      mocks.surfaceProps?.onSubmit('Use the retained research now');
    });
    await waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));

    const laterTurn = runTurn.mock.calls[1]?.[0];
    expect(laterTurn?.attachments).toEqual([]);
    const retained = laterTurn?.history?.find(
      (entry) => entry.role === 'user' && entry.attachments?.length,
    )?.attachments?.[0];
    expect(retained).toEqual({
      id: mention.id,
      filename: mention.filename,
      mimeType: mention.mimeType,
      size: mention.size,
      lastModified: mention.lastModified,
      file,
    });
    expect(retained?.file).toBe(file);
    expect(
      laterTurn?.history?.find((entry) => entry.attachments?.length)?.text,
    ).toContain('"bytesAvailable":true');
  });

  it('creates assets only from current or retained turn attachments and appends receipts', async () => {
    const historicalFile = new File(['historical bytes'], 'history.pdf', {
      type: 'application/pdf',
      lastModified: 1_786_000_002_000,
    });
    const currentFile = new File(['current bytes'], 'current.pdf', {
      type: 'application/pdf',
      lastModified: 1_786_000_003_000,
    });
    const historicalMention = registerLocalFile(historicalFile);
    const currentMention = registerLocalFile(currentFile);
    const createAsset = vi.fn<NonNullable<AgentMentionHost['createAsset']>>(
      async (input) => {
        const isCurrent =
          input.source === 'file' && input.fileOrBlob === currentFile;
        return createdAssetMention(
          isCurrent ? 'upload-current' : 'upload-history',
          input.filename ?? 'created.pdf',
        );
      },
    );
    const mentionHost = assetCreatingMentionHost({ createAsset });
    let turnNumber = 0;
    const runTurn = vi.fn(
      async (
        _args: AgentTurnArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        turnNumber += 1;
        if (turnNumber === 2) {
          const createDatoAsset = mocks.runtimeConfig?.createDatoAsset;
          expect(createDatoAsset).toBeTypeOf('function');
          await expect(
            createDatoAsset?.({
              source: 'attached_file',
              attachmentId: currentMention.id,
            }),
          ).resolves.toMatchObject({ uploadId: 'upload-current' });
          await expect(
            createDatoAsset?.({
              source: 'attached_file',
              attachmentId: historicalMention.id,
              filename: 'renamed-history.pdf',
            }),
          ).resolves.toMatchObject({ uploadId: 'upload-history' });
        }
        const result = completedResult({
          responseId: `resp_asset_attachment_${turnNumber}`,
        });
        await onEvent?.({ type: 'turn_completed', result });
        return result;
      },
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    render(
      <AgentFrame
        {...props({
          config: configForProvider('anthropic'),
          mentionHost,
        })}
      />,
    );
    act(() => {
      mocks.surfaceProps?.onSubmit(localFileSubmission(historicalMention));
    });
    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledTimes(1);
      expect(mocks.surfaceProps?.isRunning).toBe(false);
    });

    act(() => {
      mocks.surfaceProps?.onSubmit(localFileSubmission(currentMention));
    });
    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledTimes(2);
      expect(
        mocks.surfaceProps?.entries.filter((entry) => entry.kind === 'assets'),
      ).toHaveLength(2);
    });

    expect(createAsset).toHaveBeenNthCalledWith(
      1,
      {
        source: 'file',
        fileOrBlob: currentFile,
        filename: 'current.pdf',
      },
      { signal: undefined, skipConfirmation: false },
    );
    expect(createAsset).toHaveBeenNthCalledWith(
      2,
      {
        source: 'file',
        fileOrBlob: historicalFile,
        filename: 'renamed-history.pdf',
      },
      { signal: undefined, skipConfirmation: false },
    );
    const receipts =
      mocks.surfaceProps?.entries.filter((entry) => entry.kind === 'assets') ??
      [];
    expect(receipts).toEqual([
      expect.objectContaining({
        title: 'Asset created',
        assets: [expect.objectContaining({ uploadId: 'upload-current' })],
      }),
      expect.objectContaining({
        title: 'Asset created',
        assets: [expect.objectContaining({ uploadId: 'upload-history' })],
      }),
    ]);
  });

  it('rejects an attachment ID that exists in the session but not in the active turn or history', async () => {
    const rogueMention = registerLocalFile(
      new File(['rogue bytes'], 'rogue.pdf', { type: 'application/pdf' }),
    );
    const createAsset = vi.fn<NonNullable<AgentMentionHost['createAsset']>>();
    const mentionHost = assetCreatingMentionHost({ createAsset });
    const result = completedResult({ responseId: 'resp_unknown_attachment' });
    const runTurn = vi.fn(
      async (
        _args: AgentTurnArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        const createDatoAsset = mocks.runtimeConfig?.createDatoAsset;
        expect(createDatoAsset).toBeTypeOf('function');
        await expect(
          createDatoAsset?.({
            source: 'attached_file',
            attachmentId: rogueMention.id,
          }),
        ).rejects.toThrow('not available in this chat session');
        await onEvent?.({ type: 'turn_completed', result });
        return result;
      },
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ mentionHost })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Create an asset without attaching it');
    });

    await waitFor(() => expect(runTurn).toHaveBeenCalledOnce());
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('routes URL asset creation through the host callback and appends a receipt', async () => {
    const createAsset = vi.fn<NonNullable<AgentMentionHost['createAsset']>>(
      async () => createdAssetMention('upload-url', 'imported-hero.png'),
    );
    const mentionHost = assetCreatingMentionHost({ createAsset });
    const result = completedResult({ responseId: 'resp_url_asset' });
    let signal: AbortSignal | undefined;
    const runTurn = vi.fn(
      async (
        args: AgentTurnArgs,
        onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
      ) => {
        signal = args.signal;
        await mocks.runtimeConfig?.createDatoAsset?.(
          {
            source: 'url',
            url: 'https://example.com/hero.png',
            filename: 'imported-hero.png',
          },
          args.signal,
        );
        await onEvent?.({ type: 'turn_completed', result });
        return result;
      },
    );
    mocks.runtime = { runTurn } as unknown as AgentRuntime;

    render(<AgentFrame {...props({ mentionHost })} />);
    act(() => {
      mocks.surfaceProps?.onSubmit('Import the hero URL as an asset');
    });

    await waitFor(() => {
      expect(runTurn).toHaveBeenCalledOnce();
      expect(
        mocks.surfaceProps?.entries.some(
          (entry) =>
            entry.kind === 'assets' &&
            entry.assets.some((asset) => asset.uploadId === 'upload-url'),
        ),
      ).toBe(true);
    });
    expect(createAsset).toHaveBeenCalledWith(
      {
        source: 'url',
        url: 'https://example.com/hero.png',
        filename: 'imported-hero.png',
      },
      { signal, skipConfirmation: false },
    );
  });

  it.each([
    {
      label: 'enabled and clean',
      autoApprove: true,
      dirty: false,
      expectedSkip: true,
    },
    {
      label: 'disabled and clean',
      autoApprove: false,
      dirty: false,
      expectedSkip: false,
    },
    {
      label: 'enabled but dirty',
      autoApprove: true,
      dirty: true,
      expectedSkip: false,
    },
  ])(
    'sets host confirmation bypass only when auto-approve is $label',
    async ({ autoApprove, dirty, expectedSkip }) => {
      const createAsset = vi.fn<NonNullable<AgentMentionHost['createAsset']>>(
        async () => createdAssetMention('upload-auto', 'auto.png'),
      );
      const mentionHost = assetCreatingMentionHost({ createAsset });
      const frameProps = props({
        currentUserId: `asset-auto-${autoApprove}-${dirty}-${testUser}`,
        editorHasUnsavedChanges: dirty,
        mentionHost,
      });
      if (autoApprove) enableAutoApproval(frameProps);
      const result = completedResult({ responseId: 'resp_auto_asset' });
      let signal: AbortSignal | undefined;
      const runTurn = vi.fn(
        async (
          args: AgentTurnArgs,
          onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>,
        ) => {
          signal = args.signal;
          await mocks.runtimeConfig?.createDatoAsset?.(
            {
              source: 'url',
              url: 'https://example.com/auto.png',
            },
            args.signal,
          );
          await onEvent?.({ type: 'turn_completed', result });
          return result;
        },
      );
      mocks.runtime = { runTurn } as unknown as AgentRuntime;

      render(<AgentFrame {...frameProps} />);
      act(() => {
        mocks.surfaceProps?.onSubmit('Create the URL as an asset');
      });

      await waitFor(() => expect(createAsset).toHaveBeenCalledOnce());
      expect(createAsset).toHaveBeenCalledWith(
        {
          source: 'url',
          url: 'https://example.com/auto.png',
        },
        { signal, skipConfirmation: expectedSkip },
      );
    },
  );
});
