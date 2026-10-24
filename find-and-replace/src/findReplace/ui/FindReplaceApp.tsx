import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useRegisterActions } from 'datocms-react-ui/Actions';
import Canvas from 'datocms-react-ui/Canvas';
import {
  useIsPhone,
  useMediaQuery,
} from 'datocms-react-ui/hooks/useMediaQuery';
import ListArea from 'datocms-react-ui/ListArea';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  BootView,
  FindInput,
  FindReplaceAppProps,
  FindReplaceController,
  FindReplaceSnapshot,
  FindRowView,
  MetaView,
  ReplaceInput,
} from '../contract';
import { useFindReplaceEvent, useFindReplaceSnapshot } from '../useFindReplace';
import { Body, shownFieldProblems } from './Body';
import { buildConfirmOptions, buildPublishConfirmOptions } from './confirm';
import { type CalloutAction, type Copy, createCopy, STRINGS } from './copy';
import { type FieldProblemIds, FindBar, type FindBarHandlers } from './FindBar';
import styles from './FindReplaceApp.module.css';
import { LiveRegion, useAnnouncer } from './LiveRegion';
import { LoadingState, PageState } from './PaneState';
import { PrimarySlot, REPLACE_ACTION_ID } from './PrimarySlot';
import { isProgressVisible, ProgressRow } from './ProgressRow';
import { ResultsEnv, type ResultsEnvValue } from './ResultsEnv';
import { NARROW_FRAME_QUERY, type RetryOptions, TitleBar } from './TitleBar';
import {
  publishToast,
  type RunEndedEvent,
  runToast,
  showRunToast,
} from './toasts';
import { type FocusTarget, useFocusManager } from './useFocusManager';

export type { FindReplaceAppProps } from '../contract';

// ── Boot (booting, unavailable, failed) ─────────────────────────────────────

const BOOT_FIND: FindInput = {
  pattern: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};
const BOOT_REPLACE: ReplaceInput = { text: '', remove: false };
const BOOT_FIND_ROW: FindRowView = {
  enabled: false,
  showClear: false,
  showEraser: false,
  enterToSearch: false,
  awaitingEnter: false,
};
const noop = () => {};
const BOOT_HANDLERS: FindBarHandlers = {
  onPatternChange: noop,
  onFindKeyDown: noop,
  onClear: noop,
  onOptionChange: noop,
  onReplacementChange: noop,
  onReplaceKeyDown: noop,
  onRemoveChange: noop,
  onModelFilterChange: noop,
};

type NotReady = Exclude<BootView, { status: 'ready' }>;

function BootBody({ boot, copy }: { boot: NotReady; copy: Copy }) {
  switch (boot.status) {
    case 'booting':
      return <LoadingState title={STRINGS.loading} />;
    case 'unavailable':
      return (
        <PageState
          state={{ kind: 'unavailable', cause: boot.cause }}
          copy={copy}
        />
      );
    case 'failed':
      return (
        <PageState
          state={{ kind: 'bootFailed', cause: boot.cause }}
          copy={copy}
          onRetry={boot.retry}
        />
      );
  }
}

/**
 * S1 (the tool's shape, every control disabled, while the models load), S22
 * and S23 (the title and the state only: no find form, no "⋮", no button).
 */
function BootPage({ boot, copy }: { boot: NotReady; copy: Copy }) {
  const findInputId = useId();

  return (
    <Main className={styles.page}>
      <Pane
        ariaLabel={STRINGS.paneLabel}
        header={
          <>
            <TitleBar />
            {boot.status === 'booting' && (
              <FindBar
                findInputId={findInputId}
                find={BOOT_FIND}
                replace={BOOT_REPLACE}
                findRow={BOOT_FIND_ROW}
                invalid={false}
                modelFilter={null}
                copy={copy}
                handlers={BOOT_HANDLERS}
                booting
              />
            )}
          </>
        }
      >
        <ListArea>
          <BootBody boot={boot} copy={copy} />
        </ListArea>
      </Pane>
    </Main>
  );
}

// ── Ready ───────────────────────────────────────────────────────────────────

function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

function metaFromPass(event: RunEndedEvent): MetaView {
  return event.stopped
    ? {
        kind: 'runStopped',
        verb: event.verb,
        replacedMatches: event.pass.replacedMatches,
        plannedMatches: event.pass.plannedMatches,
      }
    : {
        kind: 'runFinished',
        verb: event.verb,
        replacedMatches: event.pass.replacedMatches,
        skippedRecords: event.pass.skippedRecords,
        failedRecords: event.pass.failedRecords,
        publishedRecords: 0,
      };
}

/** The meta string for a pass that ended (the snapshot's, once it reflects the end). */
export function runEndedAnnouncement(
  meta: MetaView,
  event: RunEndedEvent,
  copy: Copy,
): string {
  const expected = event.stopped ? 'runStopped' : 'runFinished';
  return copy.meta(meta.kind === expected ? meta : metaFromPass(event)) ?? '';
}

const isRunActive = (snapshot: FindReplaceSnapshot) =>
  snapshot.run.phase === 'running' || snapshot.run.phase === 'stopping';

const isPublishActive = (snapshot: FindReplaceSnapshot) =>
  snapshot.publish.phase === 'running' || snapshot.publish.phase === 'stopping';

type RequestFocus = (
  target: FocusTarget,
  when?: (snapshot: FindReplaceSnapshot) => boolean,
) => void;

/** Primary click and Mod+Enter: host confirm, then `replace(token)`. */
function useReplaceFlow(
  controller: FindReplaceController,
  ctxRef: RefObject<RenderPageCtx>,
  copy: Copy,
  requestFocus: RequestFocus,
) {
  const confirmingRef = useRef(false);

  return useCallback(() => {
    const snapshot = controller.getSnapshot();
    const plan = snapshot.plan;
    if (
      confirmingRef.current ||
      !plan ||
      snapshot.primary.kind !== 'replace' ||
      !snapshot.primary.enabled
    ) {
      return;
    }
    confirmingRef.current = true;
    const settle = (confirmed: boolean) => {
      confirmingRef.current = false;
      if (!(confirmed && controller.replace(plan.token))) {
        requestFocus('slot');
      }
    };
    Promise.resolve(
      ctxRef.current.openConfirm(buildConfirmOptions(plan, copy)),
    ).then(
      (answer) => settle(answer === true),
      () => settle(false),
    );
  }, [controller, ctxRef, copy, requestFocus]);
}

/** "Publish N records": host confirm, then `publish(token)`. */
function usePublishFlow(
  controller: FindReplaceController,
  ctxRef: RefObject<RenderPageCtx>,
  copy: Copy,
  requestFocus: RequestFocus,
) {
  const confirmingRef = useRef(false);

  return useCallback(() => {
    const { primary } = controller.getSnapshot();
    const offer = primary.kind === 'searchAgain' ? primary.publish : null;
    if (confirmingRef.current || !offer) {
      return;
    }
    confirmingRef.current = true;
    const settle = (confirmed: boolean) => {
      confirmingRef.current = false;
      if (!(confirmed && controller.publish(offer.token))) {
        requestFocus('slot');
      }
    };
    Promise.resolve(
      ctxRef.current.openConfirm(buildPublishConfirmOptions(offer, copy)),
    ).then(
      (answer) => settle(answer === true),
      () => settle(false),
    );
  }, [controller, ctxRef, copy, requestFocus]);
}

/** Cmd or Ctrl + Enter, on every system: the fields' replace keys. */
function withModifier(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.metaKey || event.ctrlKey;
}

/**
 * The fields' own keys: Enter, Cmd/Ctrl + Enter and Esc. The fields handle
 * Cmd/Ctrl + Enter themselves, so Ctrl + Enter also works on a Mac; the
 * page's replace action takes the keys elsewhere on the page.
 */
function useFindBarHandlers(
  controller: FindReplaceController,
  requestReplace: () => void,
  requestFocus: RequestFocus,
): FindBarHandlers {
  return useMemo(
    () => ({
      onPatternChange: (pattern) => controller.setPattern(pattern),
      onFindKeyDown: (event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (withModifier(event)) {
            requestReplace();
          } else {
            controller.searchNow();
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          controller.stopOrClear();
        }
      },
      onClear: () => {
        controller.clearPattern();
        requestFocus('find');
      },
      onOptionChange: (option, on) => controller.setOption(option, on),
      onReplacementChange: (text) => controller.setReplacementText(text),
      onReplaceKeyDown: (event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === 'Enter') {
          // Enter never writes: only the primary (through the confirm) does.
          event.preventDefault();
          if (withModifier(event)) {
            requestReplace();
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          controller.clearReplacement();
        }
      },
      onRemoveChange: (on) => controller.setRemove(on),
      onModelFilterChange: (modelId) => controller.setModelFilter(modelId),
    }),
    [controller, requestReplace, requestFocus],
  );
}

/**
 * The retries that the callouts above the results offer, as options of the
 * title bar's "⋮" (a callout holds only text). Only while the callouts show.
 */
function retryActions(
  snapshot: FindReplaceSnapshot,
  copy: Copy,
): CalloutAction[] {
  if (snapshot.body !== 'results' && snapshot.body !== 'noResults') {
    return [];
  }
  const actions: CalloutAction[] = [];
  for (const callout of snapshot.callouts) {
    const { action } = copy.callout(callout);
    if (action && !actions.includes(action)) {
      actions.push(action);
    }
  }
  return actions;
}

/** The element that scrolls the content of the Pane: the nearest scrolling ancestor of the marker. */
function scrollContainerOf(marker: HTMLElement): HTMLElement | null {
  for (let node = marker.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      overflowY === 'overlay'
    ) {
      return node;
    }
  }
  return marker.parentElement;
}

type ReadyPageProps = {
  ctx: RenderPageCtx;
  controller: FindReplaceController;
  copy: Copy;
};

function ReadyPage({ ctx, controller, copy }: ReadyPageProps) {
  const snapshot = useFindReplaceSnapshot(controller);
  const ctxRef = useLatest(ctx);
  const snapshotRef = useLatest(snapshot);
  const findInputId = useId();
  const patternProblemId = useId();
  const replacementProblemId = useId();
  const slotRef = useRef<HTMLElement>(null);
  const stopRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [announcement, announce] = useAnnouncer();
  const { requestFocus, onFocus } = useFocusManager({
    findId: findInputId,
    slot: slotRef,
    stop: stopRef,
    snapshot: snapshotRef,
  });
  const requestReplace = useReplaceFlow(controller, ctxRef, copy, requestFocus);
  const requestPublish = usePublishFlow(controller, ctxRef, copy, requestFocus);
  const handlers = useFindBarHandlers(controller, requestReplace, requestFocus);
  const isPhone = useIsPhone();
  const narrow = useMediaQuery(NARROW_FRAME_QUERY).matches;
  // Each invalid pattern remounts its danger callout, so its alert is read
  // again, also when the same problem comes back (Enter on the same "(").
  const [invalidCount, setInvalidCount] = useState(0);

  // The Pane keeps its scroll container to itself: scroll the one around
  // the marker at the top of the content.
  const scrollToTop = useCallback(() => {
    const container = topRef.current && scrollContainerOf(topRef.current);
    if (container) {
      container.scrollTop = 0;
    }
  }, []);

  // Ready: the caret goes to Find.
  useEffect(() => {
    document.getElementById(findInputId)?.focus();
  }, [findInputId]);

  // A new result set starts at the top.
  const resultsId = snapshot.search.resultsId;
  const shownResultsIdRef = useRef(resultsId);
  useEffect(() => {
    if (shownResultsIdRef.current !== resultsId) {
      shownResultsIdRef.current = resultsId;
      scrollToTop();
    }
  }, [resultsId, scrollToTop]);

  const onToastCta = useCallback(
    (cta: 'searchAgain' | 'retry' | null) => {
      const current = controller.getSnapshot();
      const sessionOpen =
        current.run.phase === 'finished' || current.run.phase === 'stopped';
      if (!cta || !sessionOpen) {
        return;
      }
      if (cta === 'searchAgain') {
        controller.searchAgain();
      } else if (
        current.callouts.some(
          (callout) => callout.kind === 'recordsFailed' && callout.retryable,
        )
      ) {
        controller.retryFailedRecords();
      }
    },
    [controller],
  );

  useFindReplaceEvent(controller, (event) => {
    switch (event.type) {
      case 'searchSettled':
        announce(copy.announceSettled(event));
        return;
      case 'patternInvalid':
        // The pattern problem is a danger callout, an alert of its own: the
        // live region doesn't read it a second time. A new key remounts it,
        // so the alert speaks for every event.
        setInvalidCount((count) => count + 1);
        return;
      case 'runStarted':
        requestFocus('stop', isRunActive);
        return;
      case 'runEnded':
        scrollToTop();
        requestFocus(
          'slot',
          event.stopped
            ? (next) => next.run.phase === 'stopped'
            : (next) => next.primary.kind === 'searchAgain',
        );
        announce(
          runEndedAnnouncement(controller.getSnapshot().meta, event, copy),
        );
        showRunToast(ctxRef.current, runToast(event, copy)).then(onToastCta);
        return;
      case 'publishStarted':
        requestFocus('stop', isPublishActive);
        return;
      case 'publishEnded':
        requestFocus('slot', (next) => next.primary.kind === 'searchAgain');
        announce(copy.meta(controller.getSnapshot().meta) ?? '');
        void showRunToast(ctxRef.current, publishToast(event, copy));
        return;
    }
  });

  const env = useMemo<ResultsEnvValue>(
    () => ({ controller, copy }),
    [controller, copy],
  );

  const retries: RetryOptions = {
    actions: retryActions(snapshot, copy),
    enabled: snapshot.findRow.enabled,
    onRetryRecords: () => controller.retryFailedRecords(),
    onRetryModels: () => controller.retryFailedModels(),
  };
  const { primary } = snapshot;
  const replaceEnabled = primary.kind === 'replace' && primary.enabled;
  const replaceVerb = primary.kind === 'replace' ? primary.verb : 'replace';

  // Cmd/Ctrl + Enter, an action of the page: the replace confirm, while the
  // primary is enabled. The primary shows its name and keys.
  useRegisterActions([
    {
      id: REPLACE_ACTION_ID,
      name: copy.replaceActionName(replaceVerb),
      shortcut: { key: 'enter', mod: true, runWithInputFocus: true },
      applicable: () => replaceEnabled,
      run: requestReplace,
    },
  ]);

  // Each problem of the find form shows once, above the results, and its
  // field points to it while it shows.
  const problemIds: FieldProblemIds = {
    pattern: patternProblemId,
    replacement: replacementProblemId,
  };
  const shownProblems = shownFieldProblems(snapshot);
  const fieldProblemIds: FieldProblemIds = {
    pattern: shownProblems.pattern ? patternProblemId : undefined,
    replacement: shownProblems.replacement ? replacementProblemId : undefined,
  };

  return (
    <ResultsEnv.Provider value={env}>
      <Main className={styles.page} onFocus={onFocus}>
        <Pane
          ariaLabel={STRINGS.paneLabel}
          header={
            <>
              <TitleBar
                meta={copy.meta(snapshot.meta)}
                narrow={narrow}
                retries={retries}
              >
                <PrimarySlot
                  primary={primary}
                  copy={copy}
                  onReplace={requestReplace}
                  onSearchAgain={() => {
                    controller.searchAgain();
                    requestFocus('find');
                  }}
                  onPublish={requestPublish}
                  slotRef={slotRef}
                  isPhone={isPhone}
                />
              </TitleBar>
              <FindBar
                findInputId={findInputId}
                find={snapshot.find}
                replace={snapshot.replace}
                findRow={snapshot.findRow}
                invalid={snapshot.search.phase === 'invalid'}
                problemIds={fieldProblemIds}
                modelFilter={snapshot.modelFilter}
                copy={copy}
                handlers={handlers}
              />
              {isProgressVisible(
                snapshot.search,
                snapshot.run,
                snapshot.publish,
              ) && (
                <ProgressRow
                  search={snapshot.search}
                  run={snapshot.run}
                  publish={snapshot.publish}
                  copy={copy}
                  onStopSearch={() => controller.stopSearch()}
                  onStopReplace={() => controller.stopReplace()}
                  onStopPublish={() => controller.stopPublish()}
                  stopRef={stopRef}
                  narrow={narrow}
                />
              )}
            </>
          }
        >
          <div ref={topRef} />
          <Body
            snapshot={snapshot}
            copy={copy}
            narrow={narrow}
            patternAlertKey={invalidCount}
            problemIds={problemIds}
            onRetrySearch={() => controller.retrySearch()}
            onSelectAll={(included) => controller.setAllIncluded(included)}
            onShowAllModels={() => controller.setModelFilter(null)}
          />
        </Pane>
        <LiveRegion announcement={announcement} />
      </Main>
    </ResultsEnv.Provider>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

const controllerIds = new WeakMap<FindReplaceController, number>();
let lastControllerId = 0;

/** A fresh page (focus, chunks, expanded records) for every new controller. */
function controllerKey(controller: FindReplaceController): number {
  let id = controllerIds.get(controller);
  if (id === undefined) {
    lastControllerId += 1;
    id = lastControllerId;
    controllerIds.set(controller, id);
  }
  return id;
}

/**
 * The Find and replace page: a pure renderer of the controller snapshot,
 * plus the ctx wiring (confirm, toasts, links) and focus management.
 */
export function FindReplaceApp({ ctx, boot }: FindReplaceAppProps) {
  const copy = useMemo(() => createCopy(ctx.ui.locale), [ctx.ui.locale]);

  return (
    <Canvas ctx={ctx} noAutoResizer>
      {boot.status === 'ready' ? (
        <ReadyPage
          key={controllerKey(boot.controller)}
          ctx={ctx}
          controller={boot.controller}
          copy={copy}
        />
      ) : (
        <BootPage boot={boot} copy={copy} />
      )}
    </Canvas>
  );
}
