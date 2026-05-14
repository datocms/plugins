import { buildClient } from '@datocms/cma-client-browser';

export const RECORD_BIN_WEBHOOK_NAME = '🗑️ Record Bin';
const LEGACY_RECORD_BIN_WEBHOOK_NAME = '🗑 Record Bin';
const MANAGED_RECORD_BIN_WEBHOOK_NAMES = [
  RECORD_BIN_WEBHOOK_NAME,
  LEGACY_RECORD_BIN_WEBHOOK_NAME,
] as const;

const RECORD_BIN_WEBHOOK_EVENTS = [
  {
    entity_type: 'item',
    event_types: ['delete'],
  },
];

export type RecordBinWebhookSyncErrorCode =
  | 'MISSING_ACCESS_TOKEN'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'AMBIGUOUS_RECORD_BIN_WEBHOOK'
  | 'WEBHOOK_LIST_FAILED'
  | 'WEBHOOK_CREATE_FAILED'
  | 'WEBHOOK_UPDATE_FAILED'
  | 'WEBHOOK_DELETE_FAILED';

type RecordBinWebhookSyncErrorConstructorProps = {
  code: RecordBinWebhookSyncErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export class RecordBinWebhookSyncError extends Error {
  readonly code: RecordBinWebhookSyncErrorCode;
  readonly details?: Record<string, unknown>;

  constructor({
    code,
    message,
    details,
  }: RecordBinWebhookSyncErrorConstructorProps) {
    super(message);
    this.name = 'RecordBinWebhookSyncError';
    this.code = code;
    this.details = details;
  }
}

export const isRecordBinWebhookSyncError = (
  error: unknown,
): error is RecordBinWebhookSyncError =>
  error instanceof RecordBinWebhookSyncError;

type RecordBinWebhookSyncBaseInput = {
  currentUserAccessToken: string | undefined;
  canManageWebhooks: boolean;
  environment: string;
  cmaBaseUrl?: string;
};

export type EnsureRecordBinWebhookInput = RecordBinWebhookSyncBaseInput & {
  lambdaBaseUrl: string;
};

export type RemoveRecordBinWebhookInput = RecordBinWebhookSyncBaseInput;

type WebhookOperationResult = {
  action: 'created' | 'updated' | 'deleted' | 'none';
  webhookId?: string;
};

type BulkWebhookRemovalResult = {
  action: 'deleted' | 'none';
  webhookIds: string[];
};

type WebhookCandidate = {
  id: string;
  name: string;
};

const getUnknownErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown error';
};

const getWebhookClient = ({
  currentUserAccessToken,
  canManageWebhooks,
  environment,
  cmaBaseUrl,
}: RecordBinWebhookSyncBaseInput) => {
  if (!currentUserAccessToken) {
    throw new RecordBinWebhookSyncError({
      code: 'MISSING_ACCESS_TOKEN',
      message:
        'Missing access token. Grant the plugin permission currentUserAccessToken.',
    });
  }

  if (!canManageWebhooks) {
    throw new RecordBinWebhookSyncError({
      code: 'INSUFFICIENT_PERMISSIONS',
      message:
        'Current user does not have permission to manage webhooks in this project.',
    });
  }

  return buildClient({
    apiToken: currentUserAccessToken,
    environment,
    ...(cmaBaseUrl ? { baseUrl: cmaBaseUrl } : {}),
  });
};

const isManagedWebhookName = (name: unknown): name is string =>
  typeof name === 'string' &&
  MANAGED_RECORD_BIN_WEBHOOK_NAMES.includes(
    name as (typeof MANAGED_RECORD_BIN_WEBHOOK_NAMES)[number],
  );

const isWebhookCandidate = (value: unknown): value is WebhookCandidate => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' && isManagedWebhookName(candidate.name)
  );
};

const listManagedRecordBinWebhooks = async (
  client: ReturnType<typeof buildClient>,
): Promise<WebhookCandidate[]> => {
  let webhooksResponse: unknown;

  try {
    webhooksResponse = await client.webhooks.list();
  } catch (error) {
    throw new RecordBinWebhookSyncError({
      code: 'WEBHOOK_LIST_FAILED',
      message: `Could not list existing webhooks. ${getUnknownErrorMessage(error)}`,
    });
  }

  if (!Array.isArray(webhooksResponse)) {
    return [];
  }

  return webhooksResponse.filter(isWebhookCandidate);
};

const assertSingleManagedWebhook = (managedWebhooks: WebhookCandidate[]) => {
  if (managedWebhooks.length <= 1) {
    return;
  }

  throw new RecordBinWebhookSyncError({
    code: 'AMBIGUOUS_RECORD_BIN_WEBHOOK',
    message:
      'Found multiple managed Record Bin webhooks. Resolve duplicates before continuing.',
    details: {
      webhookIds: managedWebhooks.map((webhook) => webhook.id),
      webhookNames: managedWebhooks.map((webhook) => webhook.name),
    },
  });
};

const getCanonicalWebhookPayload = (lambdaBaseUrl: string) => ({
  name: RECORD_BIN_WEBHOOK_NAME,
  url: lambdaBaseUrl,
  custom_payload: null,
  headers: {},
  events: RECORD_BIN_WEBHOOK_EVENTS,
  http_basic_user: null,
  http_basic_password: null,
  enabled: true,
  payload_api_version: '3',
  nested_items_in_payload: true,
});

export const ensureRecordBinWebhook = async ({
  lambdaBaseUrl,
  ...baseInput
}: EnsureRecordBinWebhookInput): Promise<WebhookOperationResult> => {
  const client = getWebhookClient(baseInput);
  const managedWebhooks = await listManagedRecordBinWebhooks(client);

  assertSingleManagedWebhook(managedWebhooks);

  if (managedWebhooks.length === 0) {
    try {
      const createdWebhook = await client.webhooks.create(
        getCanonicalWebhookPayload(lambdaBaseUrl),
      );

      return {
        action: 'created',
        webhookId:
          createdWebhook && typeof createdWebhook.id === 'string'
            ? createdWebhook.id
            : undefined,
      };
    } catch (error) {
      throw new RecordBinWebhookSyncError({
        code: 'WEBHOOK_CREATE_FAILED',
        message: `Could not create the Record Bin webhook. ${getUnknownErrorMessage(error)}`,
      });
    }
  }

  const webhookToUpdate = managedWebhooks[0];

  try {
    await client.webhooks.update(
      webhookToUpdate.id,
      getCanonicalWebhookPayload(lambdaBaseUrl),
    );

    return {
      action: 'updated',
      webhookId: webhookToUpdate.id,
    };
  } catch (error) {
    throw new RecordBinWebhookSyncError({
      code: 'WEBHOOK_UPDATE_FAILED',
      message: `Could not update the Record Bin webhook. ${getUnknownErrorMessage(error)}`,
      details: {
        webhookId: webhookToUpdate.id,
      },
    });
  }
};

export const removeRecordBinWebhook = async (
  baseInput: RemoveRecordBinWebhookInput,
): Promise<WebhookOperationResult> => {
  const client = getWebhookClient(baseInput);
  const managedWebhooks = await listManagedRecordBinWebhooks(client);

  assertSingleManagedWebhook(managedWebhooks);

  if (managedWebhooks.length === 0) {
    return {
      action: 'none',
    };
  }

  const webhookToDelete = managedWebhooks[0];

  try {
    await client.webhooks.destroy(webhookToDelete.id);

    return {
      action: 'deleted',
      webhookId: webhookToDelete.id,
    };
  } catch (error) {
    throw new RecordBinWebhookSyncError({
      code: 'WEBHOOK_DELETE_FAILED',
      message: `Could not delete the Record Bin webhook. ${getUnknownErrorMessage(error)}`,
      details: {
        webhookId: webhookToDelete.id,
      },
    });
  }
};

export const removeAllManagedRecordBinWebhooks = async (
  baseInput: RemoveRecordBinWebhookInput,
): Promise<BulkWebhookRemovalResult> => {
  const client = getWebhookClient(baseInput);
  const managedWebhooks = await listManagedRecordBinWebhooks(client);

  if (managedWebhooks.length === 0) {
    return {
      action: 'none',
      webhookIds: [],
    };
  }

  const deleteWebhookSequentially = async (
    deletedSoFar: string[],
    webhookToDelete: { id: string },
  ): Promise<string[]> => {
    try {
      await client.webhooks.destroy(webhookToDelete.id);
      return [...deletedSoFar, webhookToDelete.id];
    } catch (error) {
      throw new RecordBinWebhookSyncError({
        code: 'WEBHOOK_DELETE_FAILED',
        message: `Could not delete the Record Bin webhook. ${getUnknownErrorMessage(error)}`,
        details: {
          webhookId: webhookToDelete.id,
          webhookIdsDeletedBeforeFailure: deletedSoFar,
        },
      });
    }
  };

  const deletedWebhookIds = await managedWebhooks.reduce(
    (chain, webhook) =>
      chain.then((deletedSoFar) =>
        deleteWebhookSequentially(deletedSoFar, webhook),
      ),
    Promise.resolve([] as string[]),
  );

  return {
    action: 'deleted',
    webhookIds: deletedWebhookIds,
  };
};

const getDetailLines = (
  details: Record<string, unknown> | undefined,
): string[] => {
  if (!details) {
    return [];
  }

  return Object.entries(details).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}: ${value.join(', ')}`;
    }

    if (value === null || value === undefined) {
      return `${key}: ${String(value)}`;
    }

    if (typeof value === 'object') {
      return `${key}: ${JSON.stringify(value)}`;
    }

    return `${key}: ${String(value)}`;
  });
};

export const getRecordBinWebhookSyncErrorDetails = (
  error: RecordBinWebhookSyncError,
  operation: 'connect' | 'disconnect',
): string[] => {
  const title =
    operation === 'connect'
      ? 'Could not synchronize the Record Bin webhook while connecting the lambda.'
      : 'Could not delete the Record Bin webhook while disconnecting the lambda.';

  return [
    title,
    `Failure code: ${error.code}.`,
    `Failure details: ${error.message}`,
    ...getDetailLines(error.details),
    'Ensure the plugin has currentUserAccessToken permission and that your role can manage webhooks.',
  ];
};
