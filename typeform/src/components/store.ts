import Store, { thunk } from "repatch";
import produce from "immer";
import {
  Form,
  State,
  TypeformIdentityTypes,
  TypeformQueryTypes,
} from "../types";
import { Dispatch } from "redux";

const initialState = {
  query: null,
  forms: {},
  themes: {},
  searches: {},
  results: {},
};

const store = new Store(initialState).addMiddleware(thunk);
const act = (producer: (state: State) => void) => (state: State) =>
  produce(state, producer);

const hrefToId = (href: string) => {
  const match = href.match(/[^/]+$/);
  return match && match[0];
};

export const fetchThemeById =
  ({ id, client }: TypeformIdentityTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    return client.themeById(id).then((theme) => {
      dispatch(
        act((state: State) => {
          state.themes[`https://api.typeform.com/themes/${theme.id}`] = theme;
        })
      );
    });
  };

export const fetchResultsById =
  ({ id, client }: TypeformIdentityTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    return client.formResultsById(id).then((results) => {
      dispatch(
        act((state: State) => {
          state.results[id] = results;
        })
      );
    });
  };

export const fetchFormById =
  ({ id, client }: TypeformIdentityTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }

    dispatch(
      act((state: State) => {
        state.forms[id] = state.forms[id] || { result: null };
        state.forms[id].status = "loading";
      })
    );

    const formId = hrefToId(id);

    if (formId) {
      dispatch(fetchResultsById({ id: formId, client }));
    }

    return client.formById(id).then(async (form) => {
      if (form.theme) {
        const themeId = hrefToId(form.theme.href);

        if (themeId) {
          await dispatch(fetchThemeById({ id: themeId, client }));
        }
      }

      await dispatch(
        act((state: State) => {
          state.forms[id].result = form;
          state.forms[id].status = "success";
        })
      );
    });
  };

export const fetchFormsMatching =
  ({ query, client }: TypeformQueryTypes) =>
  () =>
  (dispatch: Dispatch<any>) => {
    if (!client) {
      return;
    }
    dispatch(
      act((state: State) => {
        state.searches[query] = state.searches[query] || { result: [] };
        state.searches[query].status = "loading";
        state.query = query;
      })
    );

    return client.formsMatching(query).then((forms) => {
      dispatch(
        act((state: State) => {
          state.searches[query].status = "success";
          state.searches[query].result = forms.map((f: Form) => f.id);
          forms.forEach((form: Form) => {
            state.forms[form.id] = state.forms[form.id] || {};
            state.forms[form.id].result = form;
            if (form.theme) {
              const themeId = hrefToId(form.theme.href);

              if (themeId) {
                dispatch(fetchThemeById({ id: themeId, client }));
              }
            }
          });
        })
      );
    });
  };

export default store;
