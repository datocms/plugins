import {
  createTextMatcher,
  MatcherValidationError,
  type MatcherWorkerFailure,
  type MatcherWorkerRequest,
  type MatcherWorkerResponse,
} from './matcher';

type WorkerScope = {
  onmessage: ((event: MessageEvent<MatcherWorkerRequest>) => void) | null;
  postMessage(message: MatcherWorkerResponse): void;
};

const workerScope = self as unknown as WorkerScope;

/** A run sends the same matcher with every request: compile it once. */
let lastMatcher: {
  key: string;
  match: ReturnType<typeof createTextMatcher>;
} | null = null;

function textMatcherFor(
  spec: MatcherWorkerRequest['matcher'],
): ReturnType<typeof createTextMatcher> {
  const key = JSON.stringify([
    spec.kind,
    spec.pattern,
    spec.caseSensitive,
    spec.wholeWord,
  ]);
  if (lastMatcher?.key !== key) {
    lastMatcher = { key, match: createTextMatcher(spec) };
  }
  return lastMatcher.match;
}

workerScope.onmessage = (event): void => {
  const request = event.data;
  if (request.type !== 'match_texts') return;

  try {
    const match = textMatcherFor(request.matcher);
    workerScope.postMessage({
      id: request.id,
      ok: true,
      matches: request.texts.map((text) => match(text)),
    });
  } catch (error) {
    const failure: MatcherWorkerFailure = {
      id: request.id,
      ok: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : 'Matching failed.',
        ...(error instanceof MatcherValidationError
          ? { code: error.code }
          : {}),
      },
    };
    workerScope.postMessage(failure);
  }
};
