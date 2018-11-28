const fetch = require('node-fetch');

function fetchJson(url, token = null, customHeaders = {}) {
  const headers = {};

  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  if (token) {
    Object.assign(headers, { authorization: `Bearer ${token}` });
  }

  return fetch(url, { headers })
    .then(response => (
      response.json()
        .then(json => response.ok ? json : Promise.reject(json))
    ));
}

module.exports = fetchJson;
