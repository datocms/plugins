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
  LocalizationInfo,
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
  | {
      kind: 'checking';
      /**
       * The markets of the last check of the same connection: the market
       * fields keep them on screen meanwhile, instead of leaving and coming
       * back.
       */
      localization: LocalizationInfo | null;
    }
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

/*
 * Under "Not connected", one sentence each: the cause, then what to check.
 * The editor-facing copy sends people to the plugin settings; here the
 * developer already is.
 */
export const SETTINGS_UNAUTHORIZED_MESSAGE =
  'Shopify rejected this token: use the Public access token of a Headless storefront in this store.';

const SETTINGS_FORBIDDEN_MESSAGE =
  'This token can\'t read products: enable "Read products, variants, and collections" in Shopify → Headless → Storefront API permissions.';

const SETTINGS_NETWORK_MESSAGE =
  "Couldn't reach Shopify: check your internet connection or ad blocker.";

/** The token field hides while the store connects without a token. */
const SETTINGS_TOKENLESS_LOCKED_MESSAGE =
  'This store is password-protected: switch off "Connect without a token" and paste a Storefront access token.';

function describeCheckError(error: unknown, store: StoreConnection): string {
  if (error instanceof ShopifyClientError) {
    if (error.code === 'unauthorized') return SETTINGS_UNAUTHORIZED_MESSAGE;
    if (error.code === 'forbidden') return SETTINGS_FORBIDDEN_MESSAGE;
    if (error.code === 'network') return SETTINGS_NETWORK_MESSAGE;
    if (error.code === 'store-locked' && store.tokenless) {
      return SETTINGS_TOKENLESS_LOCKED_MESSAGE;
    }
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

  const startChecking = useCallback((signature: string) => {
    setStatuses((current) => {
      const last = current[signature];
      const localization =
        last?.kind === 'connected'
          ? last.result.localization
          : last?.kind === 'checking'
            ? last.localization
            : null;
      return { ...current, [signature]: { kind: 'checking', localization } };
    });
  }, []);

  const settle = useCallback(
    (signature: string, result: ConnectionTestResult, detected: boolean) => {
      if (result.apiVersionOutdated) setApiVersionOutdated(true);
      setStatus(signature, { kind: 'connected', result, detected });
    },
    [setStatus],
  );

  const verify = useCallback(
    async (store: StoreConnection, signature: string, signal?: AbortSignal) => {
      startChecking(signature);
      try {
        const result = await getShopifyClient(store).connectionTest({ signal });
        settle(signature, result, false);
      } catch (error) {
        if (isAbortError(error)) return;
        setStatus(signature, {
          kind: 'failed',
          message: describeCheckError(error, store),
        });
      }
    },
    [setStatus, settle, startChecking],
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
      startChecking(signature);
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
            message: describeCheckError(error, store),
          });
        }
        return { ok: false };
      } finally {
        signal?.removeEventListener('abort', abort);
        controllers.current.delete(controller);
      }
    },
    [setStatus, settle, startChecking],
  );

  return { statuses, apiVersionOutdated, verify, check };
}
