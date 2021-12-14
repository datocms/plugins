import qs from "qs";

export default class TypeformClient {
  constructor({ apiToken, corsUrlPrefix }) {
    this.apiToken = apiToken;
    this.corsUrlPrefix = corsUrlPrefix;
  }

  themeById(id) {
    return this.fetch(`/themes/${id}`);
  }

  formsMatching(query) {
    return this.fetch("/forms", { search: query, page_size: 20 }).then(
      (response) => response.items
    );
  }

  formById(id) {
    return this.fetch(`/forms/${id}`);
  }

  formResultsById(id) {
    return this.fetch(`/forms/${id}/responses`, { completed: "true" });
  }

  fetch(path, params = null) {
    return fetch(
      `${this.corsUrlPrefix}https://api.typeform.com${path}${qs.stringify(
        params,
        { addQueryPrefix: true }
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      }
    ).then((res) => {
      if (res.ok) {
        return res.json();
      } else {
        throw new Error("Something went wrong");
      }
    });
  }
}
