import qs from 'qs';

export default class TypeformClient {
  constructor({ apiToken }) {
    this.apiToken = apiToken;
  }

  themeById(id) {
    return this.fetch(`/themes/${id}`);
  }

  formsMatching(query) {
    return this.fetch('/forms', { search: query, page_size: 20 }).then(response => response.items);
  }

  formById(id) {
    return this.fetch(`/forms/${id}`);
  }

  formResultsById(id) {
    return this.fetch(`/forms/${id}/responses`, { completed: 'true' });
  }

  fetch(path, params = null) {
    const proxyurl = 'https://cors-anywhere.herokuapp.com/?';

    return fetch(
      `${proxyurl}https://api.typeform.com${path}${qs.stringify(params, { addQueryPrefix: true })}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      },
    ).then(res => res.json());
  }
}
