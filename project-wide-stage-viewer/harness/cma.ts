// Stands in for src/lib/cma.ts in the harness (see vite.config.ts): a fake
// API over an in-memory store, so bulk actions really change the records.
import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import { buildRecords, WORKFLOWS } from './data';

export {
  describeError,
  fetchWorkflows,
  MissingAccessTokenError,
} from '../src/lib/cma';

type Item = RawApiTypes.Item;

const params = new URLSearchParams(location.search);
const scenario = params.get('data') ?? 'full';
const store = buildRecords(scenario === 'few' ? 6 : 68);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function allItems(): Item[] {
  return Object.values(store).flat();
}

type BulkPayload = {
  data: {
    attributes?: { stage: string };
    relationships: { items: { data: { id: string }[] } };
  };
};

function bulk(apply: (item: Item, payload: BulkPayload) => void) {
  return async (payload: BulkPayload) => {
    await wait(700);
    const ids = new Set(payload.data.relationships.items.data.map((d) => d.id));
    for (const item of allItems()) {
      if (ids.has(item.id)) apply(item, payload);
    }
    return { data: [], meta: { successful: ids.size, failed: 0 } };
  };
}

export function buildCmaClient(): Client {
  return {
    workflows: {
      list: async () => {
        await wait(300);
        return scenario === 'noworkflows' ? [] : WORKFLOWS;
      },
      find: async (id: string) => {
        await wait(150);
        const workflow = WORKFLOWS.find((candidate) => candidate.id === id);
        if (!workflow) throw new Error('Not found');
        return scenario === 'missing'
          ? { ...workflow, stages: workflow.stages.slice(0, 1) }
          : workflow;
      },
    },
    items: {
      rawList: async (query: {
        filter: {
          ids?: string;
          type?: string;
          fields?: { _stage: { eq: string } };
        };
        page?: { offset: number; limit: number };
      }) => {
        const { filter } = query;
        if (filter.type) {
          await wait(scenario === 'slow' ? 60_000 : 400);
          if (scenario === 'error') throw new Error('Network down');
          const all =
            scenario === 'empty'
              ? []
              : (store[filter.type] ?? []).filter(
                  (item) => item.meta.stage === filter.fields?._stage.eq,
                );
          const { offset = 0, limit = all.length } = query.page ?? {};
          return {
            data: all.slice(offset, offset + limit),
            meta: { total_count: all.length },
          };
        }
        await wait(200);
        const ids = new Set(filter.ids?.split(','));
        const data = allItems().filter((item) => ids.has(item.id));
        return { data, meta: { total_count: data.length } };
      },
      rawBulkPublish: bulk((item) => {
        item.meta.status = 'published';
      }),
      rawBulkUnpublish: bulk((item) => {
        item.meta.status = 'draft';
      }),
      rawBulkMoveToStage: bulk((item, payload) => {
        item.meta.stage = payload.data.attributes?.stage ?? item.meta.stage;
      }),
      rawBulkDestroy: bulk((item) => {
        for (const [model, items] of Object.entries(store)) {
          store[model] = items.filter((candidate) => candidate.id !== item.id);
        }
      }),
    },
    uploads: {
      list: async ({ filter }: { filter: { ids: string } }) => {
        await wait(200);
        return filter.ids.split(',').map((id) => ({
          id,
          is_image: true,
          url: `https://picsum.photos/seed/${id}/80/80`,
        }));
      },
    },
  } as unknown as Client;
}
