import type {
  FindReplaceController,
  FindReplaceEvent,
  FindReplaceSnapshot,
  RecordLink,
} from '../../contract';

type Method = Exclude<
  keyof FindReplaceController,
  'getSnapshot' | 'subscribe' | 'subscribeEvents'
>;

export type FakeCall = { method: Method; args: unknown[] };

export type FakeController = FindReplaceController & {
  /** Every action the UI called, in order. */
  readonly calls: FakeCall[];
  /** The argument lists of every call to `method`. */
  callsTo(method: Method): unknown[][];
  /** Replace the snapshot (the version is bumped) and notify subscribers. */
  setSnapshot(
    next:
      | FindReplaceSnapshot
      | ((current: FindReplaceSnapshot) => FindReplaceSnapshot),
  ): void;
  /** Deliver a one-shot event to the event subscribers. */
  emit(event: FindReplaceEvent): void;
  listenerCounts(): { snapshot: number; events: number };
};

type FakeControllerOptions = {
  recordLink?: (recordKey: string) => RecordLink;
};

function defaultRecordLink(recordKey: string): RecordLink {
  const [modelId, recordId] = recordKey.split(':');
  return {
    kind: 'href',
    href: `https://acme.admin.datocms.com/editor/item_types/${modelId}/items/${recordId}/edit`,
  };
}

/**
 * A contract-conforming controller that serves a fixed snapshot and records
 * every call. It mirrors the controlled inputs (pattern, options, replacement,
 * eraser) back into the snapshot so typing behaves like the real page, and
 * does nothing else: no search, no counts, no writes. For UI tests and the
 * harness state gallery.
 */
export function createFakeController(
  initial: FindReplaceSnapshot,
  options: FakeControllerOptions = {},
): FakeController {
  let snapshot = initial;
  const snapshotListeners = new Set<() => void>();
  const eventListeners = new Set<(event: FindReplaceEvent) => void>();
  const calls: FakeCall[] = [];

  const record = (method: Method, args: unknown[]) => {
    calls.push({ method, args });
  };

  const setSnapshot: FakeController['setSnapshot'] = (next) => {
    const value = typeof next === 'function' ? next(snapshot) : next;
    snapshot = { ...value, version: snapshot.version + 1 };
    for (const listener of snapshotListeners) {
      listener();
    }
  };

  const setFind = (patch: Partial<FindReplaceSnapshot['find']>) => {
    setSnapshot((current) => {
      const find = { ...current.find, ...patch };
      return {
        ...current,
        find,
        findRow: { ...current.findRow, showClear: find.pattern !== '' },
      };
    });
  };

  const setReplace = (patch: Partial<FindReplaceSnapshot['replace']>) => {
    setSnapshot((current) => ({
      ...current,
      replace: { ...current.replace, ...patch },
    }));
  };

  return {
    calls,
    callsTo: (method) =>
      calls.filter((call) => call.method === method).map((call) => call.args),
    setSnapshot,
    emit: (event) => {
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    listenerCounts: () => ({
      snapshot: snapshotListeners.size,
      events: eventListeners.size,
    }),

    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },

    setPattern: (pattern) => {
      record('setPattern', [pattern]);
      setFind({ pattern });
    },
    setOption: (option, on) => {
      record('setOption', [option, on]);
      setFind({ [option]: on });
    },
    searchNow: () => record('searchNow', []),
    clearPattern: () => {
      record('clearPattern', []);
      setFind({ pattern: '' });
    },
    stopOrClear: () => {
      record('stopOrClear', []);
      if (snapshot.search.phase === 'searching') {
        return 'stopped';
      }
      if (snapshot.find.pattern !== '' && !snapshot.hasManualSelection) {
        setFind({ pattern: '' });
        return 'cleared';
      }
      return 'kept';
    },
    stopSearch: () => record('stopSearch', []),
    searchAgain: () => record('searchAgain', []),
    retryFailedModels: () => record('retryFailedModels', []),
    retrySearch: () => record('retrySearch', []),

    setReplacementText: (text) => {
      record('setReplacementText', [text]);
      setReplace({ text });
    },
    setRemove: (on) => {
      record('setRemove', [on]);
      setReplace({ remove: on });
    },
    clearReplacement: () => {
      record('clearReplacement', []);
      setReplace({ text: '' });
    },

    setAllIncluded: (included) => record('setAllIncluded', [included]),
    setRecordIncluded: (recordKey, included) =>
      record('setRecordIncluded', [recordKey, included]),
    setMatchIncluded: (matchKey, included) =>
      record('setMatchIncluded', [matchKey, included]),

    setModelFilter: (modelId) => record('setModelFilter', [modelId]),

    replace: (token) => {
      record('replace', [token]);
      return snapshot.plan?.token === token;
    },
    stopReplace: () => record('stopReplace', []),
    retryFailedRecords: () => record('retryFailedRecords', []),

    publish: (token) => {
      record('publish', [token]);
      const { primary } = snapshot;
      return primary.kind === 'searchAgain' && primary.publish?.token === token;
    },
    stopPublish: () => record('stopPublish', []),

    recordLink: (recordKey) =>
      (options.recordLink ?? defaultRecordLink)(recordKey),

    dispose: () => record('dispose', []),
  };
}
