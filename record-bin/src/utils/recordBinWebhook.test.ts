import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClient } from "@datocms/cma-client-browser";
import {
  RECORD_BIN_WEBHOOK_NAME,
  ensureRecordBinWebhook,
  removeAllManagedRecordBinWebhooks,
  removeRecordBinWebhook,
} from "./recordBinWebhook";

vi.mock("@datocms/cma-client-browser", () => ({
  buildClient: vi.fn(),
}));

type WebhookClientMock = {
  webhooks: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
};

const createWebhookClientMock = (): WebhookClientMock => ({
  webhooks: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ensureRecordBinWebhook", () => {
  it("creates a Record Bin webhook when none exists", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([]);
    clientMock.webhooks.create.mockResolvedValue({ id: "created-id" });

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    const result = await ensureRecordBinWebhook({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
      lambdaBaseUrl: "https://record-bin.example.com",
    });

    expect(result).toEqual({ action: "created", webhookId: "created-id" });
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: "token",
      environment: "main",
    });
    expect(clientMock.webhooks.create).toHaveBeenCalledWith({
      name: RECORD_BIN_WEBHOOK_NAME,
      url: "https://record-bin.example.com",
      custom_payload: null,
      headers: {},
      events: [
        {
          entity_type: "item",
          event_types: ["delete"],
        },
      ],
      http_basic_user: null,
      http_basic_password: null,
      enabled: true,
      payload_api_version: "3",
      nested_items_in_payload: true,
    });
  });

  it("updates existing webhook URL and canonical payload", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "existing-id",
        name: RECORD_BIN_WEBHOOK_NAME,
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    const result = await ensureRecordBinWebhook({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
      lambdaBaseUrl: "https://new-record-bin.example.com",
    });

    expect(result).toEqual({ action: "updated", webhookId: "existing-id" });
    expect(clientMock.webhooks.update).toHaveBeenCalledWith("existing-id", {
      name: RECORD_BIN_WEBHOOK_NAME,
      url: "https://new-record-bin.example.com",
      custom_payload: null,
      headers: {},
      events: [
        {
          entity_type: "item",
          event_types: ["delete"],
        },
      ],
      http_basic_user: null,
      http_basic_password: null,
      enabled: true,
      payload_api_version: "3",
      nested_items_in_payload: true,
    });
  });

  it("migrates legacy webhook name to canonical name", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "legacy-id",
        name: "🗑 Record Bin",
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    await ensureRecordBinWebhook({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
      lambdaBaseUrl: "https://record-bin.example.com",
    });

    expect(clientMock.webhooks.update).toHaveBeenCalledWith(
      "legacy-id",
      expect.objectContaining({ name: RECORD_BIN_WEBHOOK_NAME })
    );
  });

  it("throws when multiple managed webhooks exist", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "webhook-1",
        name: RECORD_BIN_WEBHOOK_NAME,
      },
      {
        id: "webhook-2",
        name: "🗑 Record Bin",
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    await expect(
      ensureRecordBinWebhook({
        currentUserAccessToken: "token",
        canManageWebhooks: true,
        environment: "main",
        lambdaBaseUrl: "https://record-bin.example.com",
      })
    ).rejects.toMatchObject({
      code: "AMBIGUOUS_RECORD_BIN_WEBHOOK",
    });
  });

  it("throws when access token is missing", async () => {
    await expect(
      ensureRecordBinWebhook({
        currentUserAccessToken: undefined,
        canManageWebhooks: true,
        environment: "main",
        lambdaBaseUrl: "https://record-bin.example.com",
      })
    ).rejects.toMatchObject({
      code: "MISSING_ACCESS_TOKEN",
    });
  });

  it("throws when webhook permissions are missing", async () => {
    await expect(
      ensureRecordBinWebhook({
        currentUserAccessToken: "token",
        canManageWebhooks: false,
        environment: "main",
        lambdaBaseUrl: "https://record-bin.example.com",
      })
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_PERMISSIONS",
    });
  });
});

describe("removeRecordBinWebhook", () => {
  it("deletes an existing managed webhook", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "existing-id",
        name: RECORD_BIN_WEBHOOK_NAME,
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    const result = await removeRecordBinWebhook({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
    });

    expect(result).toEqual({ action: "deleted", webhookId: "existing-id" });
    expect(clientMock.webhooks.destroy).toHaveBeenCalledWith("existing-id");
  });

  it("returns no-op when managed webhook does not exist", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "different-id",
        name: "Some other webhook",
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    const result = await removeRecordBinWebhook({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
    });

    expect(result).toEqual({ action: "none" });
    expect(clientMock.webhooks.destroy).not.toHaveBeenCalled();
  });

  it("wraps delete errors with stable error code", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "existing-id",
        name: RECORD_BIN_WEBHOOK_NAME,
      },
    ]);
    clientMock.webhooks.destroy.mockRejectedValue(new Error("delete failed"));

    vi.mocked(buildClient).mockReturnValue(clientMock as unknown as ReturnType<typeof buildClient>);

    const removePromise = removeRecordBinWebhook({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
    });

    await expect(removePromise).rejects.toMatchObject({
      name: "RecordBinWebhookSyncError",
      code: "WEBHOOK_DELETE_FAILED",
    });
  });
});

describe("removeAllManagedRecordBinWebhooks", () => {
  it("deletes every managed Record Bin webhook, including legacy ones", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "canonical-id",
        name: RECORD_BIN_WEBHOOK_NAME,
      },
      {
        id: "legacy-id-1",
        name: "🗑 Record Bin",
      },
      {
        id: "legacy-id-2",
        name: "🗑 Record Bin",
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const result = await removeAllManagedRecordBinWebhooks({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
    });

    expect(result).toEqual({
      action: "deleted",
      webhookIds: ["canonical-id", "legacy-id-1", "legacy-id-2"],
    });
    expect(clientMock.webhooks.destroy).toHaveBeenCalledTimes(3);
    expect(clientMock.webhooks.destroy).toHaveBeenNthCalledWith(
      1,
      "canonical-id"
    );
    expect(clientMock.webhooks.destroy).toHaveBeenNthCalledWith(
      2,
      "legacy-id-1"
    );
    expect(clientMock.webhooks.destroy).toHaveBeenNthCalledWith(
      3,
      "legacy-id-2"
    );
  });

  it("returns no-op when no managed Record Bin webhooks are present", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "different-id",
        name: "Some other webhook",
      },
    ]);

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const result = await removeAllManagedRecordBinWebhooks({
      currentUserAccessToken: "token",
      canManageWebhooks: true,
      environment: "main",
    });

    expect(result).toEqual({ action: "none", webhookIds: [] });
    expect(clientMock.webhooks.destroy).not.toHaveBeenCalled();
  });

  it("wraps delete failures with stable error code and partial progress", async () => {
    const clientMock = createWebhookClientMock();
    clientMock.webhooks.list.mockResolvedValue([
      {
        id: "canonical-id",
        name: RECORD_BIN_WEBHOOK_NAME,
      },
      {
        id: "legacy-id",
        name: "🗑 Record Bin",
      },
    ]);
    clientMock.webhooks.destroy.mockResolvedValueOnce(undefined);
    clientMock.webhooks.destroy.mockRejectedValueOnce(new Error("delete failed"));

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    await expect(
      removeAllManagedRecordBinWebhooks({
        currentUserAccessToken: "token",
        canManageWebhooks: true,
        environment: "main",
      })
    ).rejects.toMatchObject({
      name: "RecordBinWebhookSyncError",
      code: "WEBHOOK_DELETE_FAILED",
      details: {
        webhookId: "legacy-id",
        webhookIdsDeletedBeforeFailure: ["canonical-id"],
      },
    });
  });
});
