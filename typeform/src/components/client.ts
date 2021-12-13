import qs from "qs";
import { ValidParameters, FetchParams } from "../types";

export default class TypeformClient {
  apiToken: string;
  corsUrlPrefix: string;

  constructor({ apiToken, corsUrlPrefix }: ValidParameters) {
    this.apiToken = apiToken;
    this.corsUrlPrefix = corsUrlPrefix;
  }

  themeById(id: string) {
    return this.fetch(`/themes/${id}`);
  }

  formsMatching(query: string) {
    return this.fetch("/forms", { search: query, page_size: 20 }).then(
      (response) => response.items
    );
  }

  formById(id: string) {
    return this.fetch(`/forms/${id}`);
  }

  formResultsById(id: string) {
    return this.fetch(`/forms/${id}/responses`, { completed: "true" });
  }

  fetch(path: string, params: FetchParams = null) {
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
    ).then((res) => res.json());
  }
}
