import type { RenderModalCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import CodeSnippet from 'datocms-react-ui/CodeSnippet';
import Heading from 'datocms-react-ui/Heading';
import InfoList from 'datocms-react-ui/InfoList';
import RawButton from 'datocms-react-ui/RawButton';
import {
  Highlight,
  type RenderProps as PrismRenderProps,
  themes,
} from 'prism-react-renderer';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  UnsafeApprovalDetail,
  UnsafeApprovalOutcomeViewModel,
  UnsafeApprovalScript,
} from '../components/AgentSurface';
import { RetryIcon, WarningIcon } from '../icons';
import type { ApprovalDetailsDecision } from '../lib/approvalDetailsModal';
import {
  generateChangeSummary,
  MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS,
} from '../lib/changeSummary';
import { normalizeConfig } from '../lib/config';
import { TEXTS } from '../texts';
import styles from './ApprovalDetailsModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type SummaryState =
  | { status: 'loading' }
  | { status: 'success'; value: string }
  | { status: 'failed' }
  | { status: 'source_too_large' };

const DECISION_PENDING_REASON = 'Wait for the decision to save.';

function isApprovalDetail(value: unknown): value is UnsafeApprovalDetail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function isApprovalScript(value: unknown): value is UnsafeApprovalScript {
  return (
    typeof value === 'object' &&
    value !== null &&
    'language' in value &&
    value.language === 'typescript' &&
    'source' in value &&
    typeof value.source === 'string' &&
    value.source.length > 0
  );
}

function isApprovalOutcome(
  value: unknown,
): value is UnsafeApprovalOutcomeViewModel {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }

  const kind = value.kind;
  const diagnostic = 'diagnostic' in value ? value.diagnostic : undefined;
  return (
    (kind === 'failed_before_execution' ||
      kind === 'failed_after_execution' ||
      kind === 'unknown') &&
    (diagnostic === undefined || typeof diagnostic === 'string')
  );
}

function sourceLines(source: string) {
  let offset = 0;
  return source.split('\n').map((content, index, lines) => {
    const entry = {
      content,
      hasFollowingLine: index < lines.length - 1,
      key: `${offset}:${content}`,
      lineNumber: index + 1,
    };
    offset += content.length + 1;
    return entry;
  });
}

function HighlightedTokens({
  getTokenProps,
  tokens,
}: {
  getTokenProps: PrismRenderProps['getTokenProps'];
  tokens: PrismRenderProps['tokens'][number];
}) {
  let offset = 0;
  const occurrences = new Map<string, number>();

  return tokens.map((token) => {
    const baseKey = `${offset}:${token.types.join('.')}:${token.content}`;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    offset += token.content.length;

    return (
      <span {...getTokenProps({ token })} key={`${baseKey}:${occurrence}`} />
    );
  });
}

function PlainCodeLines({ source }: { source: string }) {
  const lines = sourceLines(source);
  return (
    <>
      {lines.map((line) => (
        <span
          className={styles.codeLine}
          data-line-number={line.lineNumber}
          key={line.key}
        >
          <span className={styles.codeLineContent}>{line.content}</span>
          {line.hasFollowingLine ? '\n' : null}
        </span>
      ))}
    </>
  );
}

// The Prism theme gives only the colors of the tokens: the snippet draws the
// surface and the ink of the plain text, in light and dark.
function HighlightedCode({
  colorScheme,
  source,
}: {
  colorScheme: 'light' | 'dark';
  source: string;
}) {
  return (
    <Highlight
      code={source}
      language="typescript"
      theme={colorScheme === 'dark' ? themes.palenight : themes.github}
    >
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={styles.code} data-highlighted="true">
          <code data-language="typescript">
            {sourceLines(source).map((sourceLine) => {
              const highlightedLine = tokens[sourceLine.lineNumber - 1];
              const preservesSource =
                highlightedLine?.map((token) => token.content).join('') ===
                sourceLine.content;
              const lineClassName = preservesSource
                ? getLineProps({ line: highlightedLine }).className
                : '';
              return (
                <span
                  className={`${styles.codeLine} ${lineClassName}`}
                  data-line-number={sourceLine.lineNumber}
                  key={sourceLine.key}
                >
                  <span className={styles.codeLineContent}>
                    {preservesSource ? (
                      <HighlightedTokens
                        getTokenProps={getTokenProps}
                        tokens={highlightedLine}
                      />
                    ) : (
                      sourceLine.content
                    )}
                  </span>
                  {sourceLine.hasFollowingLine ? '\n' : null}
                </span>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

/**
 * The code of the change, behind a disclosure: the summary is what an editor
 * reads. It starts open only when there is no summary to read.
 */
function TypeScriptCode({
  colorScheme,
  source,
  startOpen,
}: {
  colorScheme: 'light' | 'dark';
  source: string;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const codeId = useId();
  const highlighted = source.length <= MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS;

  return (
    <div className={styles.block}>
      <RawButton
        className={styles.disclosure}
        expandable={{ open, controls: codeId }}
        onClick={() => setOpen((current) => !current)}
      >
        <DisclosureChevron open={open} />
        Show the code
      </RawButton>
      <div hidden={!open} id={codeId}>
        <CodeSnippet
          ariaLabel="Code of the change"
          code={source}
          maxHeight={360}
        >
          {highlighted ? (
            <HighlightedCode colorScheme={colorScheme} source={source} />
          ) : (
            <pre className={styles.code} data-highlighted="false">
              <code data-language="typescript">
                <PlainCodeLines source={source} />
              </code>
            </pre>
          )}
        </CodeSnippet>
      </div>
    </div>
  );
}

type SummaryProps = {
  canDecide: boolean;
  onRetry: () => void;
  retryDisabledReason: string | undefined;
  state: SummaryState;
};

// Without a summary, the editor who can't read the code can still deny
function SummaryContent({
  canDecide,
  onRetry,
  retryDisabledReason,
  state,
}: SummaryProps) {
  const codeHint = canDecide
    ? 'Check the code below, or deny the change if you’re not sure what it does.'
    : 'Check the code below.';

  if (state.status === 'loading') {
    return (
      <BlankSlate
        loading
        placement="section"
        small
        title="Summarizing this change"
      />
    );
  }

  if (state.status === 'failed') {
    return (
      <BlankSlate
        actions={
          <Button
            disabled={
              retryDisabledReason ? { reason: retryDisabledReason } : undefined
            }
            icon={RetryIcon}
            label="Try again"
            onClick={onRetry}
          />
        }
        description={codeHint}
        error
        icon={<WarningIcon />}
        placement="section"
        small
        title="Couldn’t summarize this change"
      />
    );
  }

  if (state.status === 'source_too_large') {
    return (
      <Callout
        className={styles.callout}
        title="This change is too large to summarize"
      >
        {codeHint}
      </Callout>
    );
  }

  return <p className={styles.summaryText}>{state.value}</p>;
}

// The live region holds the state of the summary. The caveat stays out of
// it: it is a standing note about every summary, not news. It shows only
// while the user decides: after the decision it can't help.
function Summary(props: SummaryProps) {
  return (
    <div className={styles.block}>
      <Heading className={styles.title} level={2}>
        Summary
      </Heading>
      <div
        aria-busy={props.state.status === 'loading'}
        aria-live="polite"
        className={styles.block}
      >
        <SummaryContent {...props} />
      </div>
      {props.canDecide && props.state.status === 'success' && (
        <Callout className={styles.callout}>
          This summary is written automatically and can be wrong: if anything
          looks unexpected, deny the change.
        </Callout>
      )}
    </div>
  );
}

// The same words as the card of the change in the chat
const OUTCOME_PRESENTATION = {
  failed_before_execution: {
    title: 'Change didn’t run',
    description: 'Nothing was changed.',
  },
  failed_after_execution: {
    title: 'Change may be incomplete',
    description:
      'Some content may have changed. Ask the agent to check, or look at the content yourself.',
  },
  unknown: {
    title: 'Not sure the change ran',
    description: 'Ask the agent to check, or look at the content yourself.',
  },
} satisfies Record<
  UnsafeApprovalOutcomeViewModel['kind'],
  { title: string; description: string }
>;

function ApprovalOutcomeNotice({
  error,
  outcome,
}: {
  /** Why the change failed, in plain words, as the card says it */
  error: string | undefined;
  outcome: UnsafeApprovalOutcomeViewModel;
}) {
  const presentation = OUTCOME_PRESENTATION[outcome.kind];

  return (
    <Callout
      className={styles.callout}
      title={presentation.title}
      tone="warning"
    >
      {error
        ? `${presentation.description} ${error}`
        : presentation.description}
    </Callout>
  );
}

/**
 * The raw error of a failed change, behind a disclosure and last: the
 * outcome, the summary and the code come first
 */
function TechnicalError({ diagnostic }: { diagnostic: string }) {
  const [open, setOpen] = useState(false);
  const diagnosticId = useId();

  return (
    <div className={styles.block}>
      <RawButton
        className={styles.disclosure}
        expandable={{ open, controls: diagnosticId }}
        onClick={() => setOpen((current) => !current)}
      >
        <DisclosureChevron open={open} />
        Show the technical error
      </RawButton>
      <div hidden={!open} id={diagnosticId}>
        <CodeSnippet
          ariaLabel="Technical error"
          code={diagnostic}
          maxHeight={180}
        />
      </div>
    </div>
  );
}

/** The decision already taken on a change that has no outcome to tell */
function DecisionNotice({ value }: { value: unknown }) {
  if (value !== 'approved' && value !== 'rejected') {
    return null;
  }

  return (
    <Callout className={styles.callout}>
      {value === 'approved' ? 'Approved.' : 'Denied. No action was taken.'}
    </Callout>
  );
}

function Decision({
  failed,
  onResolve,
  resolving,
}: {
  /** The last decision could not be saved */
  failed: boolean;
  onResolve: (decision: ApprovalDetailsDecision) => void;
  resolving: ApprovalDetailsDecision | undefined;
}) {
  return (
    <div className={styles.block}>
      {failed && (
        <Callout
          className={styles.callout}
          title="Couldn’t save this decision"
          tone="danger"
        >
          Try again.
        </Callout>
      )}
      <div className={`${styles.row} ${styles.actions}`}>
        <Button
          busy={resolving === 'deny'}
          disabled={
            resolving === 'approve'
              ? { reason: DECISION_PENDING_REASON }
              : undefined
          }
          label="Deny"
          onClick={() => onResolve('deny')}
          tone="soft"
        />
        <Button
          busy={resolving === 'approve'}
          disabled={
            resolving === 'deny'
              ? { reason: DECISION_PENDING_REASON }
              : undefined
          }
          label="Approve"
          onClick={() => onResolve('approve')}
          tone="primary"
        />
      </div>
    </div>
  );
}

export default function ApprovalDetailsModal({ ctx }: Props) {
  const details = Array.isArray(ctx.parameters.details)
    ? ctx.parameters.details.filter(isApprovalDetail)
    : [];
  const script = isApprovalScript(ctx.parameters.script)
    ? ctx.parameters.script
    : undefined;
  const outcome = isApprovalOutcome(ctx.parameters.outcome)
    ? ctx.parameters.outcome
    : undefined;
  const outcomeError =
    typeof ctx.parameters.error === 'string' && ctx.parameters.error.trim()
      ? ctx.parameters.error
      : undefined;
  const scriptSource = script?.source;
  const sourceTooLarge = Boolean(
    scriptSource && scriptSource.length > MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS,
  );
  const [resolving, setResolving] = useState<ApprovalDetailsDecision>();
  const [resolveFailed, setResolveFailed] = useState(false);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [summaryState, setSummaryState] = useState<SummaryState>({
    status: sourceTooLarge ? 'source_too_large' : 'loading',
  });
  const summaryControllerRef = useRef<AbortController | undefined>(undefined);
  const canDecide = ctx.parameters.canDecide === true;
  const config = useMemo(
    () => normalizeConfig(ctx.plugin.attributes.parameters),
    [ctx.plugin.attributes.parameters],
  );

  useEffect(() => {
    // Retrying deliberately starts the same request again.
    void summaryAttempt;
    if (!scriptSource) {
      return undefined;
    }
    if (sourceTooLarge) {
      setSummaryState({ status: 'source_too_large' });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    summaryControllerRef.current = controller;
    setSummaryState({ status: 'loading' });

    void generateChangeSummary({
      config,
      script: scriptSource,
      signal: controller.signal,
    })
      .then((summary) => {
        const value = summary.trim();
        if (active && !controller.signal.aborted) {
          setSummaryState(
            value ? { status: 'success', value } : { status: 'failed' },
          );
        }
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setSummaryState({ status: 'failed' });
        }
      })
      .finally(() => {
        if (summaryControllerRef.current === controller) {
          summaryControllerRef.current = undefined;
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (summaryControllerRef.current === controller) {
        summaryControllerRef.current = undefined;
      }
    };
  }, [config, scriptSource, sourceTooLarge, summaryAttempt]);

  const resolve = async (decision: ApprovalDetailsDecision): Promise<void> => {
    if (resolving) {
      return;
    }

    if (summaryState.status === 'loading') {
      setSummaryState({ status: 'failed' });
    }
    summaryControllerRef.current?.abort();
    summaryControllerRef.current = undefined;
    setResolving(decision);
    setResolveFailed(false);
    try {
      await ctx.resolve(decision);
    } catch {
      setResolveFailed(true);
    } finally {
      setResolving(undefined);
    }
  };

  return (
    <Canvas ctx={ctx} texts={TEXTS}>
      <div className={styles.root}>
        {outcome ? (
          <ApprovalOutcomeNotice error={outcomeError} outcome={outcome} />
        ) : (
          <DecisionNotice value={ctx.parameters.decision} />
        )}

        {scriptSource && (
          <Summary
            canDecide={canDecide}
            onRetry={() => setSummaryAttempt((attempt) => attempt + 1)}
            retryDisabledReason={
              resolving ? DECISION_PENDING_REASON : undefined
            }
            state={summaryState}
          />
        )}

        {details.length > 0 && (
          <InfoList>
            {details.map((detail) => (
              <InfoList.Row key={detail.label} title={detail.label}>
                <span className={styles.value}>{detail.value}</span>
              </InfoList.Row>
            ))}
          </InfoList>
        )}

        {scriptSource && (
          <TypeScriptCode
            colorScheme={ctx.colorScheme}
            source={scriptSource}
            startOpen={sourceTooLarge}
          />
        )}

        {outcome?.diagnostic && (
          <TechnicalError diagnostic={outcome.diagnostic} />
        )}

        {canDecide && (
          <Decision
            failed={resolveFailed}
            onResolve={(decision) => void resolve(decision)}
            resolving={resolving}
          />
        )}
      </div>
    </Canvas>
  );
}
