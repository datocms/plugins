import type { Modal } from 'datocms-plugin-sdk';
import type { ModalRequest, ModalSession } from './bridge';
import { button, el } from './dom';
import {
  HOST_DEFAULT_HEIGHT,
  KIND_LAYOUT,
  modalFrameWidth,
  modalPanelWidth,
} from './layout';

/**
 * The host's modal layer for `ctx.openModal`: a backdrop, a `surface-raised`
 * panel sized like the dashboard's (`s` 600, `m` 700, `l` 900, `xl` 1010, a
 * number is px, `fullWidth` 90% × 90%), the optional title bar, ✕ and Esc.
 * The panel holds a second frame.html that renders the `modal` surface whose
 * id matches; its `ctx.resolve(value)` settles the opener's promise.
 */

type OpenModal = { request: ModalRequest; overlay: HTMLElement };

/** The panel, title bar and body around a modal frame. Shared with the stage. */
export function modalPanel(
  frame: HTMLIFrameElement,
  options: { panelWidth: number | null; title?: string },
): HTMLElement {
  const panel = el('div', { className: 'hx-modal-panel' });
  if (options.panelWidth === null) {
    panel.classList.add('hx-modal-panel--full');
  } else {
    panel.style.width = `${options.panelWidth}px`;
    if (options.title) {
      panel.append(
        el('div', { className: 'hx-modal-title', text: options.title }),
      );
    }
  }
  panel.append(el('div', { className: 'hx-modal-body' }, [frame]));
  return panel;
}

function modalFrame(
  modal: Modal,
  src: string,
): {
  frame: HTMLIFrameElement;
  panelWidth: number | null;
} {
  const panelWidth = modalPanelWidth(modal.width);
  const frame = el('iframe', {
    className: 'hx-frame',
    attributes: { title: modal.title ?? `Modal ${modal.id}`, src },
  });
  if (panelWidth === null) {
    frame.classList.add('hx-frame--fill');
    return { frame, panelWidth };
  }
  const padding = KIND_LAYOUT.modal.bodyPadding;
  frame.style.width = `${modalFrameWidth(panelWidth)}px`;
  frame.style.height = `${(modal.initialHeight ?? HOST_DEFAULT_HEIGHT) + 2 * padding}px`;
  frame.style.margin = `-${padding}px`;
  return { frame, panelWidth };
}

function buildOverlay(
  modal: Modal,
  src: string,
  onDismiss: () => void,
): HTMLElement {
  const { frame, panelWidth } = modalFrame(modal, src);
  const overlay = el('div', { className: 'hx-overlay' }, [
    modalPanel(frame, { panelWidth, title: modal.title }),
  ]);
  if (!modal.closeDisabled) {
    const close = button('✕', onDismiss, 'hx-overlay__close');
    close.setAttribute('aria-label', 'Close');
    overlay.append(close);
  }
  return overlay;
}

export function createModalLayer(frameSrc: (sessionId: string) => string) {
  const sessions = new Map<string, OpenModal>();
  let counter = 0;

  const resolve = (sessionId: string, value: unknown) => {
    const open = sessions.get(sessionId);
    if (!open) {
      return;
    }
    sessions.delete(sessionId);
    // Settle first, while the modal frame (and the value's realm) is alive;
    // remove the frame on the next task so its current handler can finish.
    open.request.onResolve(value);
    open.overlay.hidden = true;
    setTimeout(() => open.overlay.remove(), 0);
  };

  const dismiss = (sessionId: string) => {
    const open = sessions.get(sessionId);
    if (open && !open.request.modal.closeDisabled) {
      resolve(sessionId, null);
    }
  };

  const openModal = (request: ModalRequest) => {
    counter += 1;
    const sessionId = `modal-${counter}`;
    const overlay = buildOverlay(request.modal, frameSrc(sessionId), () =>
      dismiss(sessionId),
    );
    sessions.set(sessionId, { request, overlay });
    document.body.append(overlay);
  };

  const session = (sessionId: string): ModalSession | null => {
    const open = sessions.get(sessionId);
    if (!open) {
      return null;
    }
    const { modal, pluginParameters, uiLocale } = open.request;
    return { modal, pluginParameters, uiLocale };
  };

  document.addEventListener('keydown', (event) => {
    const topmost = [...sessions.keys()].at(-1);
    if (event.key === 'Escape' && topmost) {
      dismiss(topmost);
    }
  });

  return { openModal, session, resolve, dismiss };
}
