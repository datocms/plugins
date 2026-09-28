import {
  errorReply,
  type FakeReply,
  type FakeRequest,
  filterTypes,
  itemIdFromPath,
  queryInteger,
  queryObject,
} from './http';
import {
  defaultRecords,
  generatedArticles,
  generatedAuthors,
  RECORD,
  type StoredItem,
  supportingRecords,
} from './records';
import { fieldIdFor, modelIdFor } from './schema';
import type { FakeStore } from './store';

/**
 * Scenarios (`?scenario=`). Each one picks the content, the latency, what the
 * mock ctx grants, and optional hooks that bend single requests (errors,
 * concurrent edits, flaky writes).
 */

export const SCENARIO_NAMES = [
  'default',
  'empty',
  'many',
  'large',
  'errors',
  'stale',
  'search-error',
  'boot-error',
  'denied',
  'notoken',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export function readScenarioName(value: string | null): ScenarioName {
  return SCENARIO_NAMES.find((name) => name === value) ?? 'default';
}

export type ScenarioRuntime = { store: FakeStore };

export type ScenarioHooks = {
  /** Answer the request instead of the router (the store is not touched). */
  beforeRoute?: (
    request: FakeRequest,
    runtime: ScenarioRuntime,
  ) => FakeReply | null;
  /** Runs after the router (the store already changed); may replace the reply. */
  afterRoute?: (
    request: FakeRequest,
    reply: FakeReply,
    runtime: ScenarioRuntime,
  ) => FakeReply;
};

export type Scenario = {
  name: ScenarioName;
  /** What the scenario is for (shown in the harness). */
  description: string;
  /** Default response delay in ms. */
  latency: number;
  /** The mock ctx carries `currentUserAccessToken`. */
  token: boolean;
  /** The mock role can read and update every model. */
  roleCanEdit: boolean;
  records(): StoredItem[];
  /** Called once per install, so hook state starts fresh. */
  createHooks(): ScenarioHooks;
};

const ROOT_MODEL_IDS = [
  modelIdFor('article'),
  modelIdFor('author'),
  modelIdFor('page'),
];

function isMethod(
  request: FakeRequest,
  method: string,
  path?: string,
): boolean {
  return (
    request.method === method && (path === undefined || request.path === path)
  );
}

/** A page of a model's scan: not a count (`page[limit]=1`), not a read by id. */
function isScanPage(request: FakeRequest): boolean {
  const filter = queryObject(request.query.filter);
  const page = queryObject(request.query.page);
  return (
    isMethod(request, 'GET', '/items') &&
    !filter.ids &&
    queryInteger(page.limit, 30) > 1
  );
}

function listsModel(request: FakeRequest, apiKey: 'author'): boolean {
  const types = filterTypes(request);
  return Boolean(
    isMethod(request, 'GET', '/items') &&
      types?.some((type) => type === apiKey || type === modelIdFor(apiKey)),
  );
}

// ── errors ──────────────────────────────────────────────────────────────────

/** "About the acme team" (published) has no "Published on" date. */
function errorsRecords(): StoredItem[] {
  return defaultRecords().map((record) =>
    record.id === RECORD.acmeTeam
      ? { ...record, attributes: { ...record.attributes, published_on: null } }
      : record,
  );
}

function errorsHooks(): ScenarioHooks {
  let careersFailedOnce = false;

  return {
    beforeRoute(request) {
      if (listsModel(request, 'author')) {
        return errorReply(500, 'INTERNAL_SERVER_ERROR');
      }

      // "About the acme team" saves fine, but publishing it fails the way the
      // CMA rejects an invalid record (see `errorsRecords`).
      if (isMethod(request, 'PUT', `/items/${RECORD.acmeTeam}/publish`)) {
        return errorReply(422, 'INVALID_FIELD', {
          field: 'published_on',
          field_id: fieldIdFor('article', 'published_on'),
          field_label: 'Published on',
          field_type: 'date',
          code: 'VALIDATION_REQUIRED',
        });
      }

      // The rest only bend updates (`PUT /items/:id`), not publishes.
      const id = itemIdFromPath(request.path);
      if (!id || !isMethod(request, 'PUT', `/items/${id}`)) return null;

      if (id === RECORD.pricing) {
        return errorReply(422, 'INVALID_FIELD', {
          field: 'title',
          field_id: fieldIdFor('article', 'title'),
          field_label: 'Title',
          field_type: 'string',
          code: 'VALIDATION_LENGTH',
          locale: 'en',
          max: 40,
        });
      }
      if (id === RECORD.careers && !careersFailedOnce) {
        careersFailedOnce = true;
        return { kind: 'network_error', message: 'Failed to fetch' };
      }
      if (id === RECORD.legal) {
        return errorReply(403, 'INSUFFICIENT_PERMISSIONS', {
          action: 'update',
          item_type: modelIdFor('page'),
        });
      }
      return null;
    },
  };
}

// ── stale ───────────────────────────────────────────────────────────────────

/** The type a scan page belongs to, when that page ends the model's scan. */
function completedScanType(
  request: FakeRequest,
  reply: FakeReply,
): string | null {
  const types = filterTypes(request);
  if (
    !isScanPage(request) ||
    types?.length !== 1 ||
    reply.kind !== 'json' ||
    reply.status !== 200
  ) {
    return null;
  }
  const body = queryObject(reply.body);
  const total = queryObject(body.meta).total_count;
  const served = Array.isArray(body.data) ? body.data.length : 0;
  const offset = queryInteger(queryObject(request.query.page).offset, 0);
  return typeof total === 'number' && offset + served >= total
    ? (types[0] ?? null)
    : null;
}

function replaceText(
  value: unknown,
  search: string,
  replacement: string,
): unknown {
  if (typeof value === 'string') return value.replace(search, replacement);
  if (Array.isArray(value)) {
    return value.map((entry) => replaceText(entry, search, replacement));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceText(entry, search, replacement),
      ]),
    );
  }
  return value;
}

/** Three records saved by someone else right after the search settles. */
function editAfterSearch(store: FakeStore): void {
  // A matched value changes: the writer skips it as stale.
  store.edit(RECORD.offsite, (attributes) => {
    attributes.body = replaceText(
      attributes.body,
      'in Lisbon, where we planned the next two releases',
      'in Lisbon and Porto, where we planned the next three releases',
    );
  });
  store.edit(RECORD.pricing, (attributes) => {
    attributes.title = replaceText(
      attributes.title,
      'teams, agencies and enterprises',
      'teams and enterprises',
    );
  });
  // Only an unrelated field changes: the writer replaces it and keeps the edit.
  store.edit(RECORD.brand, (attributes) => {
    attributes.published_on = '2026-03-09';
  });
}

function staleHooks(): ScenarioHooks {
  const scanned = new Set<string>();
  let edited = false;
  let legalRead = false;
  let janeFlaked = false;

  return {
    afterRoute(request, reply, { store }) {
      const completedType = edited ? null : completedScanType(request, reply);
      if (completedType) {
        scanned.add(completedType);
        if (ROOT_MODEL_IDS.every((id) => scanned.has(id))) {
          edited = true;
          editAfterSearch(store);
        }
      }

      const id = itemIdFromPath(request.path);

      // Someone saves "Legal notice" between the writer's fresh read and its
      // update: the update fails with STALE_ITEM_VERSION and nothing lands.
      if (
        edited &&
        !legalRead &&
        id === RECORD.legal &&
        isMethod(request, 'GET')
      ) {
        legalRead = true;
        store.touch(RECORD.legal);
      }

      // The first update of "Jane Doe" lands, but the answer is a transient
      // 503: the client retries on its own and gets STALE_ITEM_VERSION (the
      // writer's double-check then finds its own values and reports Replaced).
      if (
        !janeFlaked &&
        isMethod(request, 'PUT', `/items/${RECORD.jane}`) &&
        reply.kind === 'json' &&
        reply.status === 200
      ) {
        janeFlaked = true;
        return errorReply(503, 'SERVICE_UNAVAILABLE', {}, { transient: true });
      }

      return reply;
    },
  };
}

// ── search-error ────────────────────────────────────────────────────────────

/** The first scan of every model drops the connection; later requests work. */
function searchErrorHooks(): ScenarioHooks {
  const failedTypes = new Set<string>();

  return {
    beforeRoute(request) {
      const types = filterTypes(request);
      const type = types?.length === 1 ? types[0] : undefined;
      if (!type || !isScanPage(request) || failedTypes.has(type)) {
        return null;
      }
      failedTypes.add(type);
      return { kind: 'network_error', message: 'Failed to fetch' };
    },
  };
}

// ── boot-error ──────────────────────────────────────────────────────────────

function bootErrorHooks(): ScenarioHooks {
  return {
    beforeRoute(request) {
      return isMethod(request, 'GET', '/item-types')
        ? errorReply(500, 'INTERNAL_SERVER_ERROR')
        : null;
    },
  };
}

// ── Definitions ─────────────────────────────────────────────────────────────

const noHooks = (): ScenarioHooks => ({});

const BASE: Omit<Scenario, 'name' | 'description'> = {
  latency: 120,
  token: true,
  roleCanEdit: true,
  records: defaultRecords,
  createHooks: noHooks,
};

const SCENARIOS: Readonly<Record<ScenarioName, Scenario>> = {
  default: {
    ...BASE,
    name: 'default',
    description:
      '12 records in Article (drafts on), Page (drafts off) and Author, with Acme, ACME, acme, a slug and ™. Drafts-on records are published, except "ACME brand guidelines" (unpublished changes) and the drafts "Team offsite" and "Five desk setups".',
  },
  empty: {
    ...BASE,
    name: 'empty',
    description: 'The same schema with no records.',
    records: () => [],
  },
  many: {
    ...BASE,
    name: 'many',
    description:
      '3,000 generated Articles (Acme in 500 of them, "the" everywhere) plus the default Pages and Authors.',
    latency: 40,
    records: () => [...generatedArticles(3000), ...supportingRecords()],
  },
  large: {
    ...BASE,
    name: 'large',
    description:
      '12,006 records, over the 10,000 at which searches start on Enter: 7,000 generated Articles (read nested, 30 at a time) and 5,000 generated Authors (no blocks: 500 at a time). "the" reaches the 10,000-match cap, and "Search again" after replacing reads on.',
    latency: 60,
    records: () => [
      ...generatedArticles(7000),
      ...generatedAuthors(5000),
      ...supportingRecords(),
    ],
  },
  errors: {
    ...BASE,
    name: 'errors',
    description:
      'Author can’t be listed (500); "Acme pricing" fails validation (422), "Careers" drops the connection once, "Legal notice" is forbidden (403); "About the acme team" saves but can’t be published (422, "Published on" is required).',
    records: errorsRecords,
    createHooks: errorsHooks,
  },
  stale: {
    ...BASE,
    name: 'stale',
    description:
      'After the first full search, 3 records are saved by someone else; "Legal notice" changes between the fresh read and the write; the first "Jane Doe" write lands but answers 503.',
    createHooks: staleHooks,
  },
  'search-error': {
    ...BASE,
    name: 'search-error',
    description:
      'The first search of every model drops the connection, so the whole search fails; "Try again" works.',
    createHooks: searchErrorHooks,
  },
  'boot-error': {
    ...BASE,
    name: 'boot-error',
    description: 'GET /item-types answers 500.',
    createHooks: bootErrorHooks,
  },
  denied: {
    ...BASE,
    name: 'denied',
    description: 'The role has no permission rules.',
    roleCanEdit: false,
  },
  notoken: {
    ...BASE,
    name: 'notoken',
    description: 'The currentUserAccessToken permission is not granted.',
    token: false,
  },
};

export function getScenario(name: ScenarioName): Scenario {
  return SCENARIOS[name];
}
