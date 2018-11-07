import Store, { thunk } from 'repatch';
import produce from 'immer';

const initialState = {
  query: null,
  forms: {},
  themes: {},
  searches: {},
  results: {},
};

const store = new Store(initialState).addMiddleware(thunk);
const act = producer => state => produce(state, producer);
const hrefToId = href => href.match(/[^/]+$/)[0];

/* eslint-disable no-param-reassign */

export const fetchThemeById = (id, client) => () => dispatch => (
  client.themeById(id)
    .then((theme) => {
      dispatch(act((state) => {
        state.themes[`https://api.typeform.com/themes/${theme.id}`] = theme;
      }));
    })
);

export const fetchResultsById = (id, client) => () => dispatch => (
  client.formResultsById(id)
    .then((results) => {
      dispatch(act((state) => {
        state.results[id] = results;
      }));
    })
);

export const fetchFormById = (id, client) => () => (dispatch) => {
  dispatch(act((state) => {
    state.forms[id] = state.forms[id] || { result: null };
    state.forms[id].status = 'loading';
  }));

  dispatch(fetchResultsById(hrefToId(id), client));

  return client.formById(id)
    .then((form) => {
      dispatch(fetchThemeById(hrefToId(form.theme.href), client));
      dispatch(act((state) => {
        state.forms[id].result = form;
        state.forms[id].status = 'success';
      }));
    });
};

export const fetchFormsMatching = (query, client) => () => (dispatch) => {
  dispatch(act((state) => {
    state.searches[query] = state.searches[query] || { result: [] };
    state.searches[query].status = 'loading';
    state.query = query;
  }));

  return client.formsMatching(query)
    .then((forms) => {
      dispatch(act((state) => {
        state.searches[query].status = 'success';
        state.searches[query].result = forms.map(f => f.id);
        forms.forEach((form) => {
          state.forms[form.id] = state.forms[form.id] || {};
          state.forms[form.id].result = form;
          dispatch(fetchThemeById(hrefToId(form.theme.href), client));
        });
      }));
    });
};

export default store;
