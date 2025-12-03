import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDelayGroup,
  useDelayGroupContext,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react';
import type { Placement } from '@floating-ui/react';
import { Canvas, useCtx } from 'datocms-react-ui';
import * as React from 'react';
import s from './styles.module.css';

// Create a single shared portal root for all tooltips
let sharedPortalRoot: HTMLDivElement | null = null;
let portalRefCount = 0;

function getSharedPortalRoot(): HTMLDivElement {
  if (!sharedPortalRoot) {
    sharedPortalRoot = document.createElement('div');
    sharedPortalRoot.style.position = 'relative';
    sharedPortalRoot.style.zIndex = '100000';

    // Insert as the first child of body
    if (document.body.firstChild) {
      document.body.insertBefore(sharedPortalRoot, document.body.firstChild);
    } else {
      document.body.appendChild(sharedPortalRoot);
    }
  }
  portalRefCount++;
  return sharedPortalRoot;
}

function releaseSharedPortalRoot(): void {
  portalRefCount--;
  if (portalRefCount === 0 && sharedPortalRoot) {
    if (sharedPortalRoot.parentNode) {
      sharedPortalRoot.parentNode.removeChild(sharedPortalRoot);
    }
    sharedPortalRoot = null;
  }
}

interface TooltipOptions {
  initialOpen?: boolean;
  placement?: Placement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function useTooltip({
  initialOpen = false,
  placement = 'top',
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: TooltipOptions = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(initialOpen);

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = setControlledOpen ?? setUncontrolledOpen;

  const { delay } = useDelayGroupContext();

  const data = useFloating({
    placement,
    open,
    onOpenChange: setOpen,
    whileElementsMounted: autoUpdate,
    middleware: [offset(5), flip(), shift()],
  });

  const context = data.context;

  const hover = useHover(context, {
    move: false,
    enabled: controlledOpen == null,
    delay,
  });
  const focus = useFocus(context, {
    enabled: controlledOpen == null,
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const interactions = useInteractions([hover, focus, dismiss, role]);

  return React.useMemo(
    () => ({
      open,
      setOpen,
      ...interactions,
      ...data,
    }),
    [open, setOpen, interactions, data],
  );
}

type ContextType = ReturnType<typeof useTooltip> | null;

const TooltipContext = React.createContext<ContextType>(null);

export const useTooltipState = () => {
  const context = React.useContext(TooltipContext);

  if (context == null) {
    throw new Error('Tooltip components must be wrapped in <Tooltip />');
  }

  return context;
};

export function Tooltip({
  children,
  ...options
}: { children: React.ReactNode } & TooltipOptions) {
  // This can accept any props as options, e.g. `placement`,
  // or other positioning options.
  const tooltip = useTooltip(options);
  return (
    <TooltipContext.Provider value={tooltip}>
      {children}
    </TooltipContext.Provider>
  );
}

export const TooltipTrigger = React.forwardRef<
  HTMLElement,
  React.HTMLProps<HTMLElement>
>(function TooltipTrigger({ children, ...props }, propRef) {
  const state = useTooltipState();

  const childrenRef = (children as any).ref;
  const ref = useMergeRefs([state.refs.setReference, propRef, childrenRef]);

  if (!React.isValidElement(children)) {
    throw new Error('TooltipTrigger children must be a valid React element');
  }

  return React.cloneElement(
    children,
    state.getReferenceProps({
      ref,
      ...props,
      ...children.props,
      'data-state': state.open ? 'open' : 'closed',
    }),
  );
});

export const TooltipContent = React.forwardRef<
  HTMLDivElement,
  { children: React.ReactNode }
>(function TooltipContent({ children }, propRef) {
  const ctx = useCtx();
  const state = useTooltipState();
  const { isInstantPhase, currentId } = useDelayGroupContext();
  const ref = useMergeRefs([state.refs.setFloating, propRef]);

  // Use the shared portal root
  const portalRootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    // Get the shared portal root and increment ref count
    portalRootRef.current = getSharedPortalRoot();

    // Cleanup function to release the shared portal root
    return () => {
      releaseSharedPortalRoot();
    };
  }, []);

  useDelayGroup(state.context, { id: state.context.floatingId });

  const instantDuration = 0;
  const duration = 250;

  const { isMounted, styles } = useTransitionStyles(state.context, {
    duration: isInstantPhase
      ? {
          open: instantDuration,
          // `id` is this component's `id`
          // `currentId` is the current group's `id`
          close:
            currentId === state.context.floatingId ? duration : instantDuration,
        }
      : duration,
    initial: {
      opacity: 0,
    },
  });

  if (!isMounted) return null;

  return (
    <FloatingPortal root={portalRootRef}>
      <Canvas ctx={ctx} noAutoResizer>
        <div
          ref={ref}
          style={{
            ...state.floatingStyles,
            ...styles,
          }}
          {...state.getFloatingProps()}
          className={s.tooltip}
        >
          {children}
        </div>
      </Canvas>
    </FloatingPortal>
  );
});
