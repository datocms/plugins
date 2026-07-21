import { useEffect, useState } from 'react';
import type { RawField } from '../presentation/fields';

type ModelFieldsState = {
  modelId: string | null;
  fields: readonly RawField[];
  loaded: boolean;
};

export function useModelFields(
  modelId: string | null,
  loadFields: (modelId: string) => Promise<readonly RawField[]>,
): ModelFieldsState {
  const [state, setState] = useState<ModelFieldsState>({
    modelId,
    fields: [],
    loaded: modelId === null,
  });

  useEffect(() => {
    if (!modelId) {
      setState({ modelId: null, fields: [], loaded: true });
      return;
    }

    let active = true;
    setState({ modelId, fields: [], loaded: false });

    void loadFields(modelId)
      .then((fields) => {
        if (active) {
          setState({ modelId, fields, loaded: true });
        }
      })
      .catch(() => {
        if (active) {
          setState({ modelId, fields: [], loaded: true });
        }
      });

    return () => {
      active = false;
    };
  }, [loadFields, modelId]);

  return state;
}
