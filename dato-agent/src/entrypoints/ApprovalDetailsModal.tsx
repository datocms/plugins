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

function TypeScriptCode({
  colorScheme,
  source,
}: {
  colorScheme: 'light' | 'dark';
  source: string;
}) {
  const highlighted = source.length <= MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS;

  return (
    <div className={styles.block}>
      <Heading className={styles.title} level={2}>
        TypeScript
      </Heading>
      <CodeSnippet
        ariaLabel="Generated TypeScript"
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
  );
}

type SummaryProps = {
  canDecide: boolean;
  onRetry: () => void;
  retryDisabledReason: string | undefined;
  state: SummaryState;
};

function SummaryContent({
  onRetry,
  retryDisabledReason,
  state,
}: Omit<SummaryProps, 'canDecide'>) {
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
            label="Retry"
            onClick={onRetry}
          />
        }
        description="Review the TypeScript below."
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
        Review the TypeScript below.
      </Callout>
    );
  }

  return <p className={styles.summaryText}>{state.value}</p>;
}

// The live region holds the state of the summary. The caveat stays out of
// it: a warning callout announces itself, so it is not read twice.
function Summary({ canDecide, ...props }: SummaryProps) {
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
      {props.state.status === 'success' && (
        <Callout
          className={styles.callout}
          title="Summaries can be wrong"
          tone="warning"
        >
          {canDecide
            ? 'Review the TypeScript before approving.'
            : 'Review the TypeScript to verify this summary.'}
        </Callout>
      )}
    </div>
  );
}

const OUTCOME_PRESENTATION = {
  failed_before_execution: {
    title: 'Change didn’t run',
    description: 'No project content was changed.',
  },
  failed_after_execution: {
    title: 'Change may be incomplete',
    description:
      'Some project content may have changed. Check DatoCMS before trying again.',
  },
  unknown: {
    title: 'Outcome needs checking',
    description: 'The change may have run. Check DatoCMS before trying again.',
  },
} satisfies Record<
  UnsafeApprovalOutcomeViewModel['kind'],
  { title: string; description: string }
>;

function ApprovalOutcomeNotice({
  outcome,
}: {
  outcome: UnsafeApprovalOutcomeViewModel;
}) {
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const diagnosticId = useId();
  const presentation = OUTCOME_PRESENTATION[outcome.kind];

  return (
    <div className={styles.block}>
      <Callout
        className={styles.callout}
        title={presentation.title}
        tone="warning"
      >
        {presentation.description}
      </Callout>
      {outcome.diagnostic && (
        <>
          <RawButton
            className={styles.disclosure}
            expandable={{ open: diagnosticOpen, controls: diagnosticId }}
            onClick={() => setDiagnosticOpen((open) => !open)}
          >
            <DisclosureChevron open={diagnosticOpen} />
            Technical error
          </RawButton>
          <div hidden={!diagnosticOpen} id={diagnosticId}>
            <CodeSnippet
              ariaLabel="Technical error"
              code={outcome.diagnostic}
              maxHeight={180}
            />
          </div>
        </>
      )}
    </div>
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
        {outcome && <ApprovalOutcomeNotice outcome={outcome} />}

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
          <TypeScriptCode colorScheme={ctx.colorScheme} source={scriptSource} />
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
