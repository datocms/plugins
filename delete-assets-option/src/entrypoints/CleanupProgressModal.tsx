import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanupProgress } from '../utils/assetCleanup';
import {
  describeCleanupProgress,
  isCleanupProgress,
} from '../utils/cleanupProgress';

type PropTypes = {
  ctx: RenderModalCtx;
};

export default function CleanupProgressModal({ ctx }: PropTypes) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const resolvedRef = useRef(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<CleanupProgress>(() => ({
    phase: 'collecting',
    completed: 0,
    total:
      typeof ctx.parameters.recordCount === 'number' &&
      Number.isSafeInteger(ctx.parameters.recordCount) &&
      ctx.parameters.recordCount >= 0
        ? ctx.parameters.recordCount
        : 0,
    assets: 0,
  }));
  const channelId = ctx.parameters.channelId;
  const resolveModal = useCallback(
    (value: boolean | 'handoff') => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      void ctx.resolve(value);
    },
    [ctx],
  );

  useEffect(() => {
    if (resolvedRef.current) return;
    if (
      typeof channelId !== 'string' ||
      typeof BroadcastChannel === 'undefined'
    ) {
      resolveModal(false);
      return;
    }
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(channelId);
    } catch {
      resolveModal(false);
      return;
    }
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'object' || event.data === null) return;
      const message = event.data as Record<string, unknown>;
      if (message.type === 'progress' && isCleanupProgress(message.progress)) {
        setProgress(message.progress);
      } else if (message.type === 'done') {
        resolveModal(true);
      } else if (message.type === 'handoff') {
        resolveModal('handoff');
      }
    };
    // The boot frame may have reported progress or finished before mounting.
    try {
      channel.postMessage({ type: 'ready' });
    } catch {
      resolveModal(false);
    }
    return () => {
      channelRef.current = null;
      channel.onmessage = null;
      channel.close();
    };
  }, [channelId, resolveModal]);

  const cancelCleanup = () => {
    if (resolvedRef.current) return;
    setCancelled(true);
    try {
      channelRef.current?.postMessage({ type: 'cancel' });
    } catch {
      // Resolving the modal also cancels cleanup if the channel is unavailable.
    }
    resolveModal(false);
  };

  return (
    <Canvas ctx={ctx}>
      <p role="status" aria-live="polite" aria-atomic="true">
        {describeCleanupProgress(progress)}
      </p>
      <p>
        Canceling asset cleanup does not cancel record deletion. An asset
        deletion already submitted may finish.
      </p>
      <Button fullWidth disabled={cancelled} onClick={cancelCleanup}>
        Cancel asset cleanup
      </Button>
    </Canvas>
  );
}
