import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClient } from "@datocms/cma-client-browser";
import { cleanupRecordBinWithoutLambda } from "./lambdaLessCleanup";

vi.mock("@datocms/cma-client-browser", () => ({
  buildClient: vi.fn(),
}));

type ClientMock = {
  itemTypes: {
    find: ReturnType<typeof vi.fn>;
  };
  items: {
    list: ReturnType<typeof vi.fn>;
    bulkDestroy: ReturnType<typeof vi.fn>;
  };
};

const createClientMock = (): ClientMock => ({
  itemTypes: {
    find: vi.fn(),
  },
  items: {
    list: vi.fn(),
    bulkDestroy: vi.fn(),
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("cleanupRecordBinWithoutLambda", () => {
  it("deletes aged records from record_bin model", async () => {
    const clientMock = createClientMock();
    clientMock.itemTypes.find.mockResolvedValue({ id: "record-bin-model-id" });
    clientMock.items.list.mockResolvedValue([
      { id: "trash-1" },
      { id: "trash-2" },
    ]);
    clientMock.items.bulkDestroy.mockResolvedValue({});

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const result = await cleanupRecordBinWithoutLambda({
      currentUserAccessToken: "token",
      environment: "main",
      numberOfDays: 30,
    });

    expect(result).toEqual({
      deletedCount: 2,
      skipped: false,
    });
    expect(clientMock.items.list).toHaveBeenCalledWith({
      filter: {
        fields: {
          dateOfDeletion: {
            lte: expect.any(String),
          },
        },
        type: "record_bin",
      },
    });
    expect(clientMock.items.bulkDestroy).toHaveBeenCalledWith({
      items: [
        {
          type: "item",
          id: "trash-1",
        },
        {
          type: "item",
          id: "trash-2",
        },
      ],
    });
  });

  it("returns early when record_bin model does not exist", async () => {
    const clientMock = createClientMock();
    clientMock.itemTypes.find.mockRejectedValue(new Error("Not found"));

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const result = await cleanupRecordBinWithoutLambda({
      currentUserAccessToken: "token",
      environment: "main",
      numberOfDays: 30,
    });

    expect(result).toEqual({
      deletedCount: 0,
      skipped: true,
    });
    expect(clientMock.items.list).not.toHaveBeenCalled();
    expect(clientMock.items.bulkDestroy).not.toHaveBeenCalled();
  });

  it("handles empty cleanup sets", async () => {
    const clientMock = createClientMock();
    clientMock.itemTypes.find.mockResolvedValue({ id: "record-bin-model-id" });
    clientMock.items.list.mockResolvedValue([]);

    vi.mocked(buildClient).mockReturnValue(
      clientMock as unknown as ReturnType<typeof buildClient>
    );

    const result = await cleanupRecordBinWithoutLambda({
      currentUserAccessToken: "token",
      environment: "main",
      numberOfDays: 30,
    });

    expect(result).toEqual({
      deletedCount: 0,
      skipped: false,
    });
    expect(clientMock.items.bulkDestroy).not.toHaveBeenCalled();
  });
});
