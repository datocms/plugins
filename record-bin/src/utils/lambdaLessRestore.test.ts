import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClient } from "@datocms/cma-client-browser";
import {
  isLambdaLessRestoreError,
  restoreRecordWithoutLambda,
} from "./lambdaLessRestore";

vi.mock("@datocms/cma-client-browser", () => ({
  buildClient: vi.fn(),
}));

type ClientMock = {
  items: {
    rawCreate: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
};

const createClientMock = (): ClientMock => ({
  items: {
    rawCreate: vi.fn(),
    destroy: vi.fn(),
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("restoreRecordWithoutLambda", () => {
  it("restores a record, sanitizes payload and removes trash item", async () => {
    const clientMock = createClientMock();
    clientMock.items.rawCreate.mockResolvedValue({
      data: {
        id: "restored-item-id",
        relationships: {
          item_type: {
            data: {
              id: "restored-model-id",
            },
          },
        },
      },
    });
    clientMock.items.destroy.mockResolvedValue({});

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const recordBody = {
      event_type: "to_be_restored",
      environment: "main",
      entity: {
        type: "item",
        id: "deleted-item-id",
        attributes: {
          title: "Old title",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-02T00:00:00.000Z",
          content: [
            {
              id: "block-id",
              type: "item",
              attributes: {
                text: "Nested block",
              },
              relationships: {
                item_type: {
                  data: {
                    type: "item_type",
                    id: "block-model-id",
                  },
                },
              },
            },
          ],
        },
        relationships: {
          item_type: {
            data: {
              type: "item_type",
              id: "article-model-id",
            },
          },
          creator: {
            data: {
              type: "user",
              id: "user-id",
            },
          },
        },
        meta: {
          created_at: "2024-01-01T00:00:00.000Z",
          first_published_at: null,
          status: "published",
        },
      },
    };

    const result = await restoreRecordWithoutLambda({
      currentUserAccessToken: "token",
      fallbackEnvironment: "main",
      recordBody,
      trashRecordID: "trash-id",
    });

    expect(result).toEqual({
      restoredRecord: {
        id: "restored-item-id",
        modelID: "restored-model-id",
      },
    });

    const createPayload = clientMock.items.rawCreate.mock.calls[0][0];
    expect(createPayload.data.id).toBeUndefined();
    expect(createPayload.data.attributes.created_at).toBeUndefined();
    expect(createPayload.data.attributes.updated_at).toBeUndefined();
    expect(createPayload.data.relationships.creator).toBeUndefined();
    expect(createPayload.data.meta).toEqual({
      created_at: "2024-01-01T00:00:00.000Z",
      first_published_at: null,
    });
    expect(createPayload.data.attributes.content[0].id).toBeUndefined();
    expect(
      createPayload.data.attributes.content[0].relationships.item_type.data.id
    ).toBe("block-model-id");
    expect(clientMock.items.destroy).toHaveBeenCalledWith("trash-id");
  });

  it("supports raw entity payloads without webhook envelope", async () => {
    const clientMock = createClientMock();
    clientMock.items.rawCreate.mockResolvedValue({
      data: {
        id: "restored-item-id",
        relationships: {
          item_type: {
            data: {
              id: "restored-model-id",
            },
          },
        },
      },
    });
    clientMock.items.destroy.mockResolvedValue({});

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    await restoreRecordWithoutLambda({
      currentUserAccessToken: "token",
      fallbackEnvironment: "fallback-env",
      recordBody: {
        type: "item",
        id: "item-id",
        attributes: {
          title: "Standalone payload",
        },
        relationships: {
          item_type: {
            data: {
              type: "item_type",
              id: "model-id",
            },
          },
        },
        meta: {
          created_at: "2024-01-01T00:00:00.000Z",
          first_published_at: null,
        },
      },
      trashRecordID: "trash-id",
    });

    expect(buildClient).toHaveBeenCalledWith({
      apiToken: "token",
      environment: "fallback-env",
    });
  });

  it("throws LambdaLessRestoreError with lambda-like payload on rawCreate errors", async () => {
    const clientMock = createClientMock();
    clientMock.items.rawCreate.mockRejectedValue({
      errors: [
        {
          attributes: {
            code: "VALIDATION_INVALID",
            details: {
              code: "INVALID_FIELD",
              field: "title",
            },
          },
        },
      ],
    });

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    await expect(
      restoreRecordWithoutLambda({
        currentUserAccessToken: "token",
        fallbackEnvironment: "main",
        recordBody: {
          event_type: "to_be_restored",
          environment: "main",
          entity: {
            type: "item",
            id: "item-id",
            attributes: {
              title: "Broken payload",
            },
            relationships: {
              item_type: {
                data: {
                  type: "item_type",
                  id: "model-id",
                },
              },
            },
            meta: {
              created_at: "2024-01-01T00:00:00.000Z",
              first_published_at: null,
            },
          },
        },
        trashRecordID: "trash-id",
      })
    ).rejects.toSatisfy((error: unknown) => {
      if (!isLambdaLessRestoreError(error)) {
        return false;
      }

      expect(error.restorationError.simplifiedError.code).toBe(
        "VALIDATION_INVALID"
      );
      expect(error.restorationError.fullErrorPayload).toContain(
        "VALIDATION_INVALID"
      );
      return true;
    });

    expect(clientMock.items.destroy).not.toHaveBeenCalled();
  });
});
