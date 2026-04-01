import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClient, type SchemaTypes } from "@datocms/cma-client-browser";
import { captureDeletedItemsWithoutLambda } from "./lambdaLessCapture";

vi.mock("@datocms/cma-client-browser", () => ({
  buildClient: vi.fn(),
}));

type ClientMock = {
  itemTypes: {
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  fields: {
    create: ReturnType<typeof vi.fn>;
  };
  items: {
    rawFind: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const createClientMock = (): ClientMock => ({
  itemTypes: {
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  fields: {
    create: vi.fn(),
  },
  items: {
    rawFind: vi.fn(),
    create: vi.fn(),
  },
});

const createHookItem = (
  id: string,
  modelId: string
): SchemaTypes.Item =>
  ({
    type: "item",
    id,
    relationships: {
      item_type: {
        data: {
          type: "item_type",
          id: modelId,
        },
      },
    },
    attributes: {},
    meta: {} as SchemaTypes.Item["meta"],
  } as SchemaTypes.Item);

const createCtxMock = (
  token?: string
): {
  currentUserAccessToken: string | undefined;
  environment: string;
  plugin: { attributes: { parameters: Record<string, unknown> } };
  notice: ReturnType<typeof vi.fn>;
} => ({
  currentUserAccessToken: token,
  environment: "main",
  plugin: {
    attributes: {
      parameters: {},
    },
  },
  notice: vi.fn(),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("captureDeletedItemsWithoutLambda", () => {
  it("captures deleted records using nested rawFind payload", async () => {
    const clientMock = createClientMock();
    clientMock.itemTypes.find.mockResolvedValue({ id: "record-bin-model-id" });
    clientMock.items.rawFind.mockResolvedValue({
      data: {
        type: "item",
        id: "item-1",
        relationships: {
          item_type: {
            data: {
              type: "item_type",
              id: "blog-model-id",
            },
          },
        },
        attributes: {
          title: "Post title",
        },
        meta: {},
      },
    });
    clientMock.items.create.mockResolvedValue({ id: "trash-1" });

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const ctx = createCtxMock("token");

    const result = await captureDeletedItemsWithoutLambda(
      [createHookItem("item-1", "blog-model-id")],
      ctx as never
    );

    expect(result).toEqual({
      capturedCount: 1,
      failedItemIds: [],
      skippedRecordBinItems: 0,
    });
    expect(buildClient).toHaveBeenCalledWith({
      apiToken: "token",
      environment: "main",
    });
    expect(clientMock.items.rawFind).toHaveBeenCalledWith("item-1", {
      nested: true,
    });
    expect(clientMock.items.create).toHaveBeenCalledTimes(1);
    const requestPayload = clientMock.items.create.mock.calls[0][0];
    expect(requestPayload.model).toBe("blog-model-id");
    expect(requestPayload.record_body).toEqual(expect.any(String));
    expect(JSON.parse(requestPayload.record_body).event_type).toBe(
      "to_be_restored"
    );
  });

  it("skips records belonging to record_bin model", async () => {
    const clientMock = createClientMock();
    clientMock.itemTypes.find.mockResolvedValue({ id: "record-bin-model-id" });

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const ctx = createCtxMock("token");

    const result = await captureDeletedItemsWithoutLambda(
      [createHookItem("trash-item", "record-bin-model-id")],
      ctx as never
    );

    expect(result).toEqual({
      capturedCount: 0,
      failedItemIds: [],
      skippedRecordBinItems: 1,
    });
    expect(clientMock.items.rawFind).not.toHaveBeenCalled();
    expect(clientMock.items.create).not.toHaveBeenCalled();
  });

  it("aggregates failures and keeps deletion fail-open", async () => {
    const clientMock = createClientMock();
    clientMock.itemTypes.find.mockResolvedValue({ id: "record-bin-model-id" });
    clientMock.items.rawFind
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({
        data: {
          type: "item",
          id: "item-2",
          relationships: {
            item_type: {
              data: {
                type: "item_type",
                id: "page-model-id",
              },
            },
          },
          attributes: {
            title: "Page title",
          },
          meta: {},
        },
      });
    clientMock.items.create.mockResolvedValue({ id: "trash-2" });

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const ctx = createCtxMock("token");

    const result = await captureDeletedItemsWithoutLambda(
      [
        createHookItem("item-1", "post-model-id"),
        createHookItem("item-2", "page-model-id"),
      ],
      ctx as never
    );

    expect(result.capturedCount).toBe(1);
    expect(result.failedItemIds).toEqual(["item-1"]);
    expect(ctx.notice).toHaveBeenCalledWith(
      "Record Bin could not archive 1 deleted record(s). Deletion still completed."
    );
  });

  it("warns and returns when access token is missing", async () => {
    const ctx = createCtxMock();

    const result = await captureDeletedItemsWithoutLambda(
      [createHookItem("item-1", "blog-model-id")],
      ctx as never
    );

    expect(result.capturedCount).toBe(0);
    expect(result.failedItemIds).toEqual(["item-1"]);
    expect(ctx.notice).toHaveBeenCalledWith(
      "Record Bin could not archive deleted records because currentUserAccessToken is missing."
    );
    expect(buildClient).not.toHaveBeenCalled();
  });
});
