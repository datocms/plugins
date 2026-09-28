import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
import { Body, BodySpinner } from './Body';
import { buildConfirmOptions, buildPublishConfirmOptions } from './confirm';
import { type CalloutAction, type Copy, createCopy, STRINGS } from './copy';
import { FindBar, type FindBarHandlers } from './FindBar';
import { LiveRegion, useAnnouncer } from './LiveRegion';
import { PaneState } from './PaneState';
import { PrimarySlot } from './PrimarySlot';
import { isProgressVisible, ProgressRow } from './ProgressRow';
import { ResultsEnv, type ResultsEnvValue } from './ResultsEnv';
import { TitleBar } from './TitleBar';
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
      return <BodySpinner label={STRINGS.loading} />;
    case 'unavailable':
      return (
        <PaneState
          pane={{ kind: 'unavailable', cause: boot.cause }}
          copy={copy}
        />
      );
    case 'failed':
      return (
        <PaneState
          pane={{ kind: 'bootFailed', cause: boot.cause }}
          copy={copy}
          onRetry={boot.retry}
        />
      );
  }
}

/** S1 (the tool's shape, every control disabled), S22 and S23 (title only). */
function BootPage({ boot, copy }: { boot: NotReady; copy: Copy }) {
  const findInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="dl-pane dl-pane--last">
      <TitleBar />
      {boot.status === 'booting' && (
        <FindBar
          find={BOOT_FIND}
          replace={BOOT_REPLACE}
          findRow={BOOT_FIND_ROW}
          invalid={false}
          modelFilter={null}
          copy={copy}
          findInputRef={findInputRef}
          handlers={BOOT_HANDLERS}
        />
      )}
      <div className="dl-pane__body">
        <BootBody boot={boot} copy={copy} />
      </div>
    </div>
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

function isModEnter(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

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
          if (isModEnter(event)) {
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
          if (isModEnter(event)) {
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

type ReadyPageProps = {
  ctx: RenderPageCtx;
  controller: FindReplaceController;
  copy: Copy;
};

function ReadyPage({ ctx, controller, copy }: ReadyPageProps) {
  const snapshot = useFindReplaceSnapshot(controller);
  const ctxRef = useLatest(ctx);
  const snapshotRef = useLatest(snapshot);
  const findRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [announcement, announce] = useAnnouncer();
  const { requestFocus, onFocus } = useFocusManager({
    find: findRef,
    slot: slotRef,
    progress: progressRef,
    snapshot: snapshotRef,
  });
  const requestReplace = useReplaceFlow(controller, ctxRef, copy, requestFocus);
  const requestPublish = usePublishFlow(controller, ctxRef, copy, requestFocus);
  const handlers = useFindBarHandlers(controller, requestReplace, requestFocus);

  const scrollToTop = useCallback(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, []);

  // Ready: the caret goes to Find.
  useEffect(() => {
    findRef.current?.focus();
  }, []);

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
        announce(copy.patternProblem(event.problem));
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
    () => ({
      controller,
      copy,
      navigateTo: (path) => {
        ctxRef.current.navigateTo(path);
      },
    }),
    [controller, copy, ctxRef],
  );

  const onCalloutAction = useCallback(
    (action: CalloutAction) => {
      if (action === 'retryRecords') {
        controller.retryFailedRecords();
      } else {
        controller.retryFailedModels();
      }
    },
    [controller],
  );

  return (
    <ResultsEnv.Provider value={env}>
      <div className="dl-pane dl-pane--last" onFocus={onFocus}>
        <TitleBar meta={copy.meta(snapshot.meta)}>
          <PrimarySlot
            primary={snapshot.primary}
            copy={copy}
            onReplace={requestReplace}
            onSearchAgain={() => {
              controller.searchAgain();
              requestFocus('find');
            }}
            onPublish={requestPublish}
            slotRef={slotRef}
          />
        </TitleBar>
        <FindBar
          find={snapshot.find}
          replace={snapshot.replace}
          findRow={snapshot.findRow}
          invalid={snapshot.search.phase === 'invalid'}
          modelFilter={snapshot.modelFilter}
          copy={copy}
          findInputRef={findRef}
          handlers={handlers}
        />
        {isProgressVisible(snapshot.search, snapshot.run, snapshot.publish) && (
          <ProgressRow
            search={snapshot.search}
            run={snapshot.run}
            publish={snapshot.publish}
            copy={copy}
            onStopSearch={() => controller.stopSearch()}
            onStopReplace={() => controller.stopReplace()}
            onStopPublish={() => controller.stopPublish()}
            containerRef={progressRef}
          />
        )}
        <div className="dl-pane__body" ref={bodyRef}>
          <Body
            snapshot={snapshot}
            copy={copy}
            onRetrySearch={() => controller.retrySearch()}
            onCalloutAction={onCalloutAction}
            onSelectAll={(included) => controller.setAllIncluded(included)}
          />
        </div>
      </div>
      <LiveRegion announcement={announcement} />
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
      <div className="fr-app">
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
      </div>
    </Canvas>
  );
}
