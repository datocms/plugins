import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeError,
  getShopifyClient,
  isAbortError,
  onApiVersionWarning,
  ShopifyClientError,
} from '../../lib/shopifyClient';
import type {
  ConnectionTestResult,
  StoreCapabilities,
  StoreConnection,
} from '../../types';

/**
 * Connection checks for the config screen, keyed by connection signature
 * (see `connectionSignature`):
 * - `verify` runs the connection test only (on mount, for saved stores with
 *   saved capabilities);
 * - `check` also detects capabilities (Test connection, Re-check, Save, and
 *   on mount for saved stores without capabilities).
 */
export type ConnectionStatus =
  | { kind: 'checking' }
  | {
      kind: 'connected';
      result: ConnectionTestResult;
      /** Capabilities were detected this session (not just read from settings). */
      detected: boolean;
    }
  | { kind: 'failed'; message: string };

export type CheckOutcome =
  | { ok: true; capabilities: StoreCapabilities }
  | { ok: false };

export type ConnectionChecks = {
  statuses: Readonly<Record<string, ConnectionStatus>>;
  /** Set when Shopify reports the pinned API version as expired. */
  apiVersionOutdated: boolean;
  verify: (
    store: StoreConnection,
    signature: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  check: (
    store: StoreConnection,
    signature: string,
    signal?: AbortSignal,
  ) => Promise<CheckOutcome>;
};

/**
 * The editor-facing copy sends people to the plugin settings; here the
 * developer already is, so say what to check instead.
 */
export const SETTINGS_UNAUTHORIZED_MESSAGE =
  'Shopify rejected this token. Check that it\'s the "Public access token" of a Headless storefront in this store.';

function describeCheckError(error: unknown): string {
  if (error instanceof ShopifyClientError && error.code === 'unauthorized') {
    return SETTINGS_UNAUTHORIZED_MESSAGE;
  }
  return describeError(error);
}

export function useConnectionChecks(): ConnectionChecks {
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>(
    {},
  );
  const [apiVersionOutdated, setApiVersionOutdated] = useState(false);
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const unsubscribe = onApiVersionWarning(() => setApiVersionOutdated(true));
    const active = controllers.current;
    return () => {
      unsubscribe();
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, []);

  const setStatus = useCallback(
    (signature: string, status: ConnectionStatus) => {
      setStatuses((current) => ({ ...current, [signature]: status }));
    },
    [],
  );

  const settle = useCallback(
    (signature: string, result: ConnectionTestResult, detected: boolean) => {
      if (result.apiVersionOutdated) setApiVersionOutdated(true);
      setStatus(signature, { kind: 'connected', result, detected });
    },
    [setStatus],
  );

  const verify = useCallback(
    async (store: StoreConnection, signature: string, signal?: AbortSignal) => {
      setStatus(signature, { kind: 'checking' });
      try {
        const result = await getShopifyClient(store).connectionTest({ signal });
        settle(signature, result, false);
      } catch (error) {
        if (isAbortError(error)) return;
        setStatus(signature, {
          kind: 'failed',
          message: describeCheckError(error),
        });
      }
    },
    [setStatus, settle],
  );

  const check = useCallback(
    async (
      store: StoreConnection,
      signature: string,
      signal?: AbortSignal,
    ): Promise<CheckOutcome> => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      controllers.current.add(controller);
      setStatus(signature, { kind: 'checking' });
      try {
        const client = getShopifyClient(store);
        const [result, capabilities] = await Promise.all([
          client.connectionTest({ signal: controller.signal }),
          client.detectCapabilities({ signal: controller.signal }),
        ]);
        settle(signature, result, true);
        return { ok: true, capabilities };
      } catch (error) {
        if (!isAbortError(error)) {
          setStatus(signature, {
            kind: 'failed',
            message: describeCheckError(error),
          });
        }
        return { ok: false };
      } finally {
        signal?.removeEventListener('abort', abort);
        controllers.current.delete(controller);
      }
    },
    [setStatus, settle],
  );

  return { statuses, apiVersionOutdated, verify, check };
}
