import type { RenderUploadSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createAssetEnvironmentOperations,
  describeError,
  type Environment,
  type EnvironmentFailure,
  type Progress,
} from '../utils/assetEnvironmentOperations';
import { sortByEnvUpdateTime } from '../utils/sortByEnvUpdateTime';
import { EnvironmentList } from './EnvironmentList';

type Scope = {
  apiToken: string | null | undefined;
  uploadId: string;
  currentEnv: string;
  baseUrl: string;
  allowed: boolean;
  checkVersion: number;
};

type View = {
  scope: Scope | null;
  loadingMessage: string | null;
  matches: Environment[];
  lookupFailures: EnvironmentFailure[];
  deletionFailures: EnvironmentFailure[];
  discoveryError: string | null;
  actionError: string | null;
  busy: boolean;
};

const initialView: View = {
  scope: null,
  loadingMessage: 'Loading...',
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

function progressMessage(action: string, { completed, total }: Progress) {
  return total > 10
    ? `${action} ${completed} of ${total} environments...`
    : `${action} ${total} environment(s)...`;
}

function Failures({ failures }: { failures: EnvironmentFailure[] }) {
  const [expanded, setExpanded] = useState(false);
  if (failures.length === 0) return null;
  return (
    <>
      <ul>
        {failures.slice(0, 5).map((failure) => (
          <li key={failure.envId}>
            {failure.envId}: {failure.message}
          </li>
        ))}
      </ul>
      {failures.length > 5 && (
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>Show {failures.length - 5} more environment errors</summary>
          {expanded && (
            <ul style={{ maxHeight: 240, overflow: 'auto' }}>
              {failures.slice(5).map((failure) => (
                <li key={failure.envId}>
                  {failure.envId}: {failure.message}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </>
  );
}

function deletionNotice(
  result: Awaited<ReturnType<Session['operations']['deleteCopies']>>,
  hasLookupFailures: boolean,
) {
  const parts = [`Deleted ${result.deletedEnvIds.length} other copies.`];
  if (result.absentEnvIds.length > 0) {
    parts.push(
      `${result.absentEnvIds.length} copies confirmed already absent.`,
    );
  }
  parts.push(
    result.failures.length > 0 || hasLookupFailures
      ? 'Some environments could not be completed. See the remaining copies and errors in this panel.'
      : 'You must delete the last copy in the current environment manually.',
  );
  return parts.join(' ');
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
            patch({ loadingMessage: progressMessage('Checking', progress) }),
        );
        patch({
          matches: result.matches.sort(sortByEnvUpdateTime),
          lookupFailures: result.failures,
          loadingMessage: null,
        });
      } catch (error) {
        patch({ discoveryError: describeError(error), loadingMessage: null });
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
        title: `Delete ${targets.length} other copies?`,
        content: `Are you sure? This will delete the asset from ${targets.length} other environments. Then you'll still have to manually delete this last copy in the current environment.`,
        choices: [
          { label: 'Delete all', value: 'deleteAll', intent: 'negative' },
        ],
        cancel: { label: 'Go back', value: 'cancel' },
      });
      if (userConfirmed !== 'deleteAll' || !active()) return;
      const result = await session.operations.deleteCopies(
        targets,
        scope.uploadId,
        scope.currentEnv,
        (progress) => {
          patch({ loadingMessage: progressMessage('Deleting from', progress) });
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
      patch({ busy: false, loadingMessage: null });
    }
  };

  if (!allowed) {
    return (
      <Canvas ctx={ctx}>
        <p>
          You do not have the right permissions to run this plugin. Please check
          with your admin.
        </p>
      </Canvas>
    );
  }

  const loadingMessage =
    view.scope !== scope ? 'Loading...' : view.loadingMessage;
  if (loadingMessage) {
    return (
      <Canvas ctx={ctx}>
        <strong>
          <Spinner size={20} />
          {loadingMessage}
        </strong>
        <p>Please wait...</p>
      </Canvas>
    );
  }

  const incomplete = Boolean(
    view.discoveryError || view.lookupFailures.length > 0,
  );
  return (
    <Canvas ctx={ctx}>
      {incomplete && (
        <>
          <p>
            Could not check every environment. Other copies may still exist.
          </p>
          {view.discoveryError && <p>{view.discoveryError}</p>}
          <Failures failures={view.lookupFailures} />
          <Button
            onClick={() => setCheckVersion((version) => version + 1)}
            disabled={view.busy}
          >
            Retry check
          </Button>
        </>
      )}
      {view.actionError && <p>{view.actionError}</p>}
      <Failures failures={view.deletionFailures} />
      {view.matches.length > 0 ? (
        <>
          <p>Asset found in {view.matches.length} other environment(s):</p>
          <EnvironmentList
            environments={view.matches}
            currentEnv={scope.currentEnv}
            uploadId={scope.uploadId}
            projectDomain={
              ctx.site.attributes.internal_domain ??
              `${ctx.site.id}.admin.datocms.com`
            }
          />
          <Button onClick={deleteFromAllEnvs} disabled={view.busy}>
            Delete this asset from {view.matches.length} other env(s)
          </Button>
        </>
      ) : !incomplete ? (
        <>
          <p>
            This is the last remaining copy of this asset.{' '}
            <strong>
              You must delete it manually using the regular "Delete" link at the
              top of this sidebar.
            </strong>
          </p>
          <p>This is a safety measure, sorry!</p>
          <p>
            <strong>
              Once you delete this final copy, the asset should disappear from
              our CDN (datocms-assets.com) within 24 hours.
            </strong>
          </p>
        </>
      ) : null}
    </Canvas>
  );
};
