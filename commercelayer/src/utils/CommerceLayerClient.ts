import qs from 'qs';
import { ValidConfig } from '../types';

export type Product = {
  id: string;
  attributes: {
    image_url: string;
    name: string;
    code: string;
    description: string;
  };
};

export default class CommerceLayerClient {
  baseEndpoint: string;
  clientId: string;
  token: string | null;

  constructor({
    baseEndpoint,
    clientId,
  }: Pick<ValidConfig, 'baseEndpoint' | 'clientId'>) {
    this.baseEndpoint = baseEndpoint;
    this.clientId = clientId;
    this.token = null;
  }

  async productsMatching(query: string): Promise<Product[]> {
    const result = await this.get('/api/skus', {
      'filter[q][code_or_name_or_description_cont]': query,
      'page[size]': 10,
    });

    return result.data;
  }

  async productByCode(code: string): Promise<Product> {
    const result = await this.get('/api/skus', {
      'filter[q][code_cont]': code,
    });

    if (result.data.length === 0) {
      throw new Error('Missing SKU');
    }

    return result.data[0];
  }

  async getToken() {
    if (this.token) {
      return this.token;
    }

    const response = await fetch(`${this.baseEndpoint}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Invalid status code: ${response.status}`);
    }

    const body = await response.json();

    this.token = body.access_token;

    return this.token;
  }

  async get(path: string, filters = {}) {
    const token = await this.getToken();

    const response = await fetch(
      `${this.baseEndpoint}${path}${qs.stringify(filters, {
        addQueryPrefix: true,
      })}`,
      {
        headers: {
          accept: 'application/vnd.api+json',
          authorization: `Bearer ${token}`,
        },
      },
    );

    if (response.status !== 200) {
      throw new Error(`Invalid status code: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');

    if (!contentType || !contentType.includes('application/vnd.api+json')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const body = await response.json();

    return body;
  }
}
