import type { RenderUploadSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Canvas from 'datocms-react-ui/Canvas';
import EntityRow from 'datocms-react-ui/EntityRow';
import type { Message } from 'datocms-react-ui/Message';
import RowList from 'datocms-react-ui/RowList';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { CircleExclamationIcon } from '../icons';
import {
  createAssetEnvironmentOperations,
  describeError,
  type Environment,
  type EnvironmentFailure,
} from '../utils/assetEnvironmentOperations';
import { sortByEnvUpdateTime } from '../utils/sortByEnvUpdateTime';
import { EnvironmentList } from './EnvironmentList';
import styles from './styles.module.css';

type Scope = {
  apiToken: string | null | undefined;
  uploadId: string;
  currentEnv: string;
  baseUrl: string;
  allowed: boolean;
  checkVersion: number;
};

type Loading = { title: string; caption?: Message };

type View = {
  scope: Scope | null;
  loading: Loading | null;
  matches: Environment[];
  lookupFailures: EnvironmentFailure[];
  deletionFailures: EnvironmentFailure[];
  discoveryError: string | null;
  actionError: string | null;
  busy: boolean;
};

const CHECKING = 'Looking for other copies';
const DELETING = 'Deleting the other copies';

const initialView: View = {
  scope: null,
  loading: { title: CHECKING },
  matches: [],
  lookupFailures: [],
  deletionFailures: [],
  discoveryError: null,
  actionError: null,
  busy: false,
};

type Session = {
  scope: Scope;
  controller: AbortController;
  operations: ReturnType<typeof createAssetEnvironmentOperations>;
  busy: boolean;
};

/** The texts of the panel that have a count, for `{ id, values }` messages */
export const texts = {
  'deleteAsset.checked':
    '{completed, number} of {total, plural, one {# environment} other {# environments}} checked',
  'deleteAsset.deleted':
    '{completed, number} of {total, plural, one {# environment} other {# environments}} done',
  'deleteAsset.moreErrors':
    'Show {count, plural, one {# more error} other {# more errors}}',
  'deleteAsset.deleteCopies':
    'Delete {count, plural, one {# other copy} other {# other copies}}',
  'deleteAsset.moreEnvironments':
    'Show {count, plural, one {# more environment} other {# more environments}}',
};

/**
 * "1 other copy", "3 other copies": for the texts that are plain strings (the
 * toast and the confirm dialog of the host, a sentence of the panel)
 */
function plural(count: number, one: string, other: string) {
  return `${count} ${count === 1 ? one : other}`;
}

/**
 * The environments that failed: a callout that tells it, then their rows, the
 * first five and the rest on demand. The buttons go right after the list,
 * never in the callout.
 */
function Failures({
  tone,
  title,
  text,
  failures,
  action,
}: {
  tone: 'warning' | 'danger';
  title: string;
  text: string;
  failures: EnvironmentFailure[];
  action?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (failures.length === 0) return null;
  const hidden = failures.length - 5;
  return (
    <>
      <Callout tone={tone} title={title} className={styles.callout}>
        {text}
      </Callout>
      <RowList density="compact">
        {(expanded ? failures : failures.slice(0, 5)).map((failure) => (
          <RowList.Item key={failure.envId}>
            <EntityRow layout="row" title={failure.envId}>
              {failure.message}
            </EntityRow>
          </RowList.Item>
        ))}
      </RowList>
      {(hidden > 0 || action) && (
        <div className={styles.actions}>
          {hidden > 0 && (
            <Button
              tone="ghost"
              label={
                expanded
                  ? 'Show fewer errors'
                  : { id: 'deleteAsset.moreErrors', values: { count: hidden } }
              }
              onClick={() => setExpanded((value) => !value)}
            />
          )}
          {action}
        </div>
      )}
    </>
  );
}

function deletionNotice(
  result: Awaited<ReturnType<Session['operations']['deleteCopies']>>,
  hasLookupFailures: boolean,
) {
  const parts = [
    `Deleted ${plural(result.deletedEnvIds.length, 'other copy', 'other copies')}.`,
  ];
  if (result.absentEnvIds.length > 0) {
    parts.push(
      `${plural(result.absentEnvIds.length, 'other copy was', 'other copies were')} already gone.`,
    );
  }
  parts.push(
    result.failures.length > 0 || hasLookupFailures
      ? 'Some environments failed: see the panel for details.'
      : 'Now delete the last copy yourself, in this environment.',
  );
  return parts.join(' ');
}

/** The checked environments: what failed, the other copies, or the last one */
function Results({
  view,
  uploadId,
  onRecheck,
  onDelete,
}: {
  view: View;
  uploadId: string;
  onRecheck: () => void;
  onDelete: () => void;
}) {
  const count = view.matches.length;
  return (
    <div className={styles.panel}>
      <Failures
        tone="warning"
        title="Some environments weren't checked"
        text="Other copies of this asset may still exist there."
        failures={view.lookupFailures}
        action={
          <Button
            label="Check again"
            onClick={onRecheck}
            disabled={
              view.busy
                ? {
                    reason:
                      "You can't check again while copies are being deleted.",
                  }
                : undefined
            }
          />
        }
      />
      {view.actionError && (
        <Callout
          tone="danger"
          title="The copies weren't deleted"
          className={styles.callout}
        >
          {view.actionError}
        </Callout>
      )}
      <Failures
        tone="danger"
        title="Some copies weren't deleted"
        text="They're still listed below."
        failures={view.deletionFailures}
      />
      {count > 0 && (
        <>
          <p>
            This asset is also in{' '}
            {plural(count, 'other environment', 'other environments')}.
          </p>
          <EnvironmentList environments={view.matches} uploadId={uploadId} />
          <div className={styles.actions}>
            <Button
              tone="alert"
              label={{ id: 'deleteAsset.deleteCopies', values: { count } }}
              busy={view.busy}
              onClick={onDelete}
            />
          </div>
        </>
      )}
      {count === 0 && view.lookupFailures.length === 0 && (
        <Callout title="This is the last copy" className={styles.callout}>
          Delete it with the “Delete” action at the top of this sidebar. Within
          24 hours it then leaves our CDN (datocms-assets.com).
        </Callout>
      )}
    </div>
  );
}

export const AssetDeletionSidebar = ({
  ctx,
}: {
  ctx: RenderUploadSidebarPanelCtx;
}) => {
  const { currentUserAccessToken, currentRole, environment, cmaBaseUrl } = ctx;
  const [checkVersion, setCheckVersion] = useState(0);
  const uploadId = ctx.upload.id;
  const allowed = Boolean(
    currentUserAccessToken &&
      currentRole?.meta.final_permissions.environments_access === 'all',
  );
  const scope = useMemo<Scope>(
    () => ({
      apiToken: currentUserAccessToken,
      uploadId,
      currentEnv: environment,
      baseUrl: cmaBaseUrl,
      allowed,
      checkVersion,
    }),
    [
      currentUserAccessToken,
      uploadId,
      environment,
      cmaBaseUrl,
      allowed,
      checkVersion,
    ],
  );
  const [view, setView] = useState<View>(initialView);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    if (!scope.allowed || !scope.apiToken) return;
    const controller = new AbortController();
    const operations = createAssetEnvironmentOperations({
      apiToken: scope.apiToken,
      baseUrl: scope.baseUrl,
      signal: controller.signal,
    });
    const session: Session = { scope, controller, operations, busy: false };
    sessionRef.current = session;
    setView({ ...initialView, scope });
    const patch = (changes: Partial<View>) => {
      if (!controller.signal.aborted) {
        setView((previous) =>
          previous.scope === scope ? { ...previous, ...changes } : previous,
        );
      }
    };

    const discover = async () => {
      try {
        const environments = await operations.listEnvironments();
        const result = await operations.checkEnvironments(
          environments,
          scope.uploadId,
          scope.currentEnv,
          (progress) =>
            patch({
              loading: {
                title: CHECKING,
                caption: { id: 'deleteAsset.checked', values: progress },
              },
            }),
        );
        patch({
          matches: result.matches.sort(sortByEnvUpdateTime),
          lookupFailures: result.failures,
          loading: null,
        });
      } catch (error) {
        patch({ discoveryError: describeError(error), loading: null });
      }
    };
    void discover();
    return () => {
      controller.abort();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [scope]);

  const deleteFromAllEnvs = async () => {
    const session = sessionRef.current;
    if (
      !session ||
      session.scope !== scope ||
      session.busy ||
      view.matches.length === 0
    )
      return;
    session.busy = true;
    setView((previous) => ({ ...previous, busy: true, actionError: null }));
    const targets = view.matches;
    const active = () =>
      !session.controller.signal.aborted && sessionRef.current === session;
    const patch = (changes: Partial<View>) => {
      if (active()) setView((previous) => ({ ...previous, ...changes }));
    };
    try {
      const userConfirmed = await ctx.openConfirm({
        title: `Delete ${plural(targets.length, 'other copy', 'other copies')}?`,
        content: `This deletes the asset from ${plural(targets.length, 'other environment', 'other environments')}. The copy in this environment stays: delete it yourself afterwards.`,
        choices: [
          { label: 'Delete all', value: 'deleteAll', intent: 'negative' },
        ],
        cancel: { label: 'Cancel', value: 'cancel' },
      });
      if (userConfirmed !== 'deleteAll' || !active()) return;
      const result = await session.operations.deleteCopies(
        targets,
        scope.uploadId,
        scope.currentEnv,
        (progress) => {
          patch({
            loading: {
              title: DELETING,
              caption: { id: 'deleteAsset.deleted', values: progress },
            },
          });
        },
      );
      if (!active()) return;
      const removed = new Set([
        ...result.deletedEnvIds,
        ...result.absentEnvIds,
      ]);
      setView((previous) => ({
        ...previous,
        matches: previous.matches.filter((env) => !removed.has(env.id)),
        deletionFailures: result.failures,
      }));
      // Notification failure must not overwrite the confirmed deletion results.
      void ctx
        .notice(deletionNotice(result, view.lookupFailures.length > 0))
        .catch(() => undefined);
    } catch (error) {
      patch({ actionError: describeError(error) });
    } finally {
      session.busy = false;
      patch({ busy: false, loading: null });
    }
  };

  const loading = view.scope !== scope ? initialView.loading : view.loading;
  const recheck = () => setCheckVersion((version) => version + 1);

  let content: ReactNode;
  if (!allowed) {
    content = (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<CircleExclamationIcon />}
        title="No access to all environments"
        description="Your role needs access to every environment to find and delete the other copies of this asset. Ask a project admin."
      />
    );
  } else if (loading) {
    content = (
      <BlankSlate
        placement="inline"
        small
        loading
        title={loading.title}
        caption={loading.caption}
      />
    );
  } else if (view.discoveryError) {
    content = (
      <BlankSlate
        placement="inline"
        small
        error
        icon={<CircleExclamationIcon />}
        title="The environments weren't checked"
        code={view.discoveryError}
        description="Other copies of this asset may still exist. Check again in a moment."
        actions={<Button label="Check again" onClick={recheck} />}
      />
    );
  } else {
    content = (
      <Results
        view={view}
        uploadId={scope.uploadId}
        onRecheck={recheck}
        onDelete={() => {
          void deleteFromAllEnvs();
        }}
      />
    );
  }

  return (
    <Canvas ctx={ctx} texts={texts}>
      {content}
    </Canvas>
  );
};
