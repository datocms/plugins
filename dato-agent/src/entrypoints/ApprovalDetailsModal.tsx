import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
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
import type { ApprovalDetailsDecision } from '../lib/approvalDetailsModal';
import {
  generateChangeSummary,
  MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS,
} from '../lib/changeSummary';
import { normalizeConfig } from '../lib/config';
import styles from './ApprovalDetailsModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type SummaryState =
  | { status: 'loading' }
  | { status: 'success'; value: string }
  | { status: 'failed' }
  | { status: 'source_too_large' };

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

function TypeScriptCode({
  colorScheme,
  source,
}: {
  colorScheme: 'light' | 'dark';
  source: string;
}) {
  const headingId = useId();
  const highlighted = source.length <= MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS;

  return (
    <section className={styles.codeSection}>
      <h2 id={headingId}>Generated TypeScript</h2>
      {highlighted ? (
        <Highlight
          code={source}
          language="typescript"
          theme={colorScheme === 'dark' ? themes.palenight : themes.github}
        >
          {({ tokens, getLineProps, getTokenProps, style }) => (
            <pre
              aria-labelledby={headingId}
              className={styles.codeBlock}
              data-highlighted="true"
              style={{ color: style.color }}
            >
              <code data-language="typescript">
                {sourceLines(source).map((sourceLine) => {
                  const highlightedLine = tokens[sourceLine.lineNumber - 1];
                  const preservesSource =
                    highlightedLine?.map((token) => token.content).join('') ===
                    sourceLine.content;
                  const lineProps = preservesSource
                    ? getLineProps({ line: highlightedLine })
                    : { className: '' };
                  return (
                    <span
                      {...lineProps}
                      className={`${styles.codeLine} ${lineProps.className}`}
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
      ) : (
        <pre
          aria-labelledby={headingId}
          className={styles.codeBlock}
          data-highlighted="false"
        >
          <code data-language="typescript">
            <PlainCodeLines source={source} />
          </code>
        </pre>
      )}
    </section>
  );
}

function Summary({
  canDecide,
  disabled,
  onRetry,
  state,
}: {
  canDecide: boolean;
  disabled: boolean;
  onRetry: () => void;
  state: SummaryState;
}) {
  if (state.status === 'loading') {
    return (
      <section aria-busy="true" aria-live="polite" className={styles.summary}>
        <h2>Generating a summary of this change</h2>
        <div aria-hidden="true" className={styles.summaryShimmer}>
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  if (state.status === 'failed') {
    return (
      <section aria-live="polite" className={styles.summary}>
        <h2>Summary</h2>
        <div className={styles.summaryFailure}>
          <p>Couldn’t generate a summary. Review the TypeScript below.</p>
          <Button
            buttonSize="xxs"
            buttonType="muted"
            disabled={disabled}
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  if (state.status === 'source_too_large') {
    return (
      <section aria-live="polite" className={styles.summary}>
        <h2>Summary</h2>
        <div className={styles.summaryFailure}>
          <p>
            This change is too large to summarize. Review the TypeScript below.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-live="polite" className={styles.summary}>
      <h2>Summary</h2>
      <p className={styles.summaryText}>{state.value}</p>
      <p className={styles.summaryWarning}>
        AI-generated summaries can be wrong.{' '}
        {canDecide
          ? 'Review the TypeScript before approving.'
          : 'Review the TypeScript to verify this summary.'}
      </p>
    </section>
  );
}

function ApprovalOutcomeNotice({
  outcome,
}: {
  outcome: UnsafeApprovalOutcomeViewModel;
}) {
  const presentation = {
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
      description:
        'The change may have run. Check DatoCMS before trying again.',
    },
  }[outcome.kind];

  return (
    <section className={styles.outcomeNotice} role="status">
      <strong>{presentation.title}</strong>
      <p>{presentation.description}</p>
      {outcome.diagnostic && (
        <details className={styles.technicalError}>
          <summary>Technical error</summary>
          <pre>{outcome.diagnostic}</pre>
        </details>
      )}
    </section>
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
  const [resolveError, setResolveError] = useState<string>();
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
    setResolveError(undefined);
    try {
      await ctx.resolve(decision);
    } catch {
      setResolveError('Could not save this decision. Try again.');
    } finally {
      setResolving(undefined);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div className={styles.root}>
        {outcome && <ApprovalOutcomeNotice outcome={outcome} />}

        {scriptSource && (
          <Summary
            canDecide={canDecide}
            disabled={Boolean(resolving)}
            onRetry={() => setSummaryAttempt((attempt) => attempt + 1)}
            state={summaryState}
          />
        )}

        {details.length > 0 && (
          <dl className={styles.metadata}>
            {details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {scriptSource && (
          <TypeScriptCode colorScheme={ctx.colorScheme} source={scriptSource} />
        )}

        {canDecide && (
          <>
            {resolveError && (
              <p className={styles.resolveError} role="alert">
                {resolveError}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                buttonSize="s"
                buttonType="negative"
                disabled={Boolean(resolving)}
                onClick={() => void resolve('deny')}
              >
                {resolving === 'deny' ? 'Denying…' : 'Deny'}
              </Button>
              <Button
                buttonSize="s"
                buttonType="primary"
                disabled={Boolean(resolving)}
                onClick={() => void resolve('approve')}
              >
                {resolving === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Canvas>
  );
}
