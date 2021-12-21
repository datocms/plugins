import qs from "qs";
import { ValidParameters } from "../types";

export default class CommerceLayerClient {
  baseEndpoint: string;
  clientId: string;
  token: string | null;

  constructor({ baseEndpoint, clientId }: ValidParameters) {
    this.baseEndpoint = baseEndpoint;
    this.clientId = clientId;
    this.token = null;
  }

  productsMatching(query: string) {
    return this.get("/api/skus", {
      "filter[q][code_or_name_or_description_cont]": query,
      "page[size]": query ? 8 : 4,
    }).then((result) => result.data);
  }

  productByCode(code: string) {
    return this.get("/api/skus", { "filter[q][code_cont]": code }).then(
      (result) => result.data[0]
    );
  }

  getToken() {
    if (this.token) {
      return Promise.resolve(this.token);
    }

    return fetch(`${this.baseEndpoint}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
      }),
    })
      .then((res) => res.json())
      .then((body) => {
        this.token = body.access_token;
        return this.token;
      });
  }

  get(path: string, filters = {}) {
    return this.getToken()
      .then((token) =>
        fetch(
          `${this.baseEndpoint}${path}${qs.stringify(filters, {
            addQueryPrefix: true,
          })}`,
          {
            headers: {
              accept: "application/vnd.api+json",
              authorization: `Bearer ${token}`,
            },
          }
        )
      )
      .then((res) => res.json());
  }
}
