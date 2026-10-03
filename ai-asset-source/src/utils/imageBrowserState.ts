import type {
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
} from './imageService/types';

export const MAX_REQUESTS = 5;
// A conservative UTF-16 estimate of both the base64 and the preview data URI.
// This is a retention budget, not a measurement of browser heap usage.
export const MAX_HISTORY_BYTES = 384 * 1024 * 1024;

export type SelectedImage = {
  request: NormalizedGenerationBatch;
  image: NormalizedGeneratedImage;
};

export type ImageBrowserState = {
  requests: NormalizedGenerationBatch[];
  selectedIds: Set<string>;
  sentIds: Set<string>;
  evictedSelectedCount: number;
};

export const initialImageBrowserState: ImageBrowserState = {
  requests: [],
  selectedIds: new Set(),
  sentIds: new Set(),
  evictedSelectedCount: 0,
};

type Action =
  | { type: 'add'; batch: NormalizedGenerationBatch }
  | { type: 'toggle'; id: string }
  | { type: 'unavailable'; id: string }
  | { type: 'sent'; ids: string[] }
  | { type: 'rejected'; id: string };

export function imageBrowserReducer(
  state: ImageBrowserState,
  action: Action,
): ImageBrowserState {
  switch (action.type) {
    case 'add':
      return addBatch(state, action.batch);
    case 'toggle': {
      if (
        state.sentIds.has(action.id) ||
        !getSelectableIds(state.requests).has(action.id)
      ) {
        return state;
      }
      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(action.id)) {
        selectedIds.delete(action.id);
      } else {
        selectedIds.add(action.id);
      }
      return { ...state, selectedIds };
    }
    case 'unavailable': {
      const selectedIds = new Set(state.selectedIds);
      selectedIds.delete(action.id);
      return { ...state, selectedIds };
    }
    case 'sent': {
      const selectedIds = new Set(state.selectedIds);
      const sentIds = new Set(state.sentIds);
      for (const id of action.ids) {
        selectedIds.delete(id);
        sentIds.add(id);
      }
      return { ...state, selectedIds, sentIds };
    }
    case 'rejected': {
      const sentIds = new Set(state.sentIds);
      sentIds.delete(action.id);
      const selectedIds = new Set(state.selectedIds);
      if (getSelectableIds(state.requests).has(action.id))
        selectedIds.add(action.id);
      return { ...state, selectedIds, sentIds };
    }
  }
}

function addBatch(
  state: ImageBrowserState,
  batch: NormalizedGenerationBatch,
): ImageBrowserState {
  const requests: NormalizedGenerationBatch[] = [];
  let bytes = 0;
  for (const request of [batch, ...state.requests]) {
    const requestBytes = estimateBatchBytes(request);
    if (
      requests.length >= MAX_REQUESTS ||
      bytes + requestBytes > MAX_HISTORY_BYTES
    )
      break;
    requests.push(request);
    bytes += requestBytes;
  }
  const selectableIds = getSelectableIds(requests);
  const selectedIds = new Set(
    [...state.selectedIds].filter((id) => selectableIds.has(id)),
  );
  return {
    requests,
    selectedIds,
    sentIds: new Set([...state.sentIds].filter((id) => selectableIds.has(id))),
    evictedSelectedCount: state.selectedIds.size - selectedIds.size,
  };
}

export function estimateBatchBytes(batch: NormalizedGenerationBatch): number {
  let bytes = 0;
  for (const image of batch.images) {
    if (image.kind === 'success')
      bytes += 2 * (image.base64.length + image.previewSrc.length);
  }
  return bytes;
}

function getSelectableIds(requests: NormalizedGenerationBatch[]): Set<string> {
  const ids = new Set<string>();
  for (const request of requests) {
    for (const image of request.images) {
      if (image.kind === 'success') ids.add(image.id);
    }
  }
  return ids;
}

export function getSelectedImages(state: ImageBrowserState): SelectedImage[] {
  const selected: SelectedImage[] = [];
  for (const request of state.requests) {
    for (const image of request.images) {
      if (
        image.kind === 'success' &&
        state.selectedIds.has(image.id) &&
        !state.sentIds.has(image.id)
      ) {
        selected.push({ request, image });
      }
    }
  }
  return selected;
}
