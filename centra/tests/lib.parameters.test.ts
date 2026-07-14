import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONNECTION,
  isConnectionComplete,
  normalizeConnection,
  normalizeFieldParameters,
  normalizePluginParameters,
  resolveConnection,
  validateConnection,
  validateEndpoint,
} from '../src/lib/parameters';

describe('Centra parameter normalization', () => {
  it('normalizes unknown values to stable defaults', () => {
    expect(normalizePluginParameters(null)).toEqual({
      paramsVersion: '2',
      ...EMPTY_CONNECTION,
    });
    expect(normalizeFieldParameters(undefined)).toEqual({
      paramsVersion: '1',
      kind: 'primaryProduct',
      cardinality: 'single',
    });
  });

  it('keeps only trimmed connection credentials', () => {
    expect(
      normalizeConnection({
        endpoint: ' https://example.com/graphql ',
        token: ' token ',
        marketId: '42',
        pricelistId: 7,
        defaultLanguageCode: ' en ',
        languageByDatoLocale: { ' en-US ': ' en ', empty: ' ' },
      }),
    ).toEqual({
      endpoint: 'https://example.com/graphql',
      token: 'token',
    });
  });

  it('supports a legacy flat connection while emitting the v2 shape', () => {
    const parameters = normalizePluginParameters({
      endpoint: 'https://example.com/graphql',
      token: 'token',
    });
    expect(parameters.endpoint).toBe('https://example.com/graphql');
    expect(parameters.paramsVersion).toBe('2');
  });

  it('migrates the old default connection and drops advanced settings', () => {
    const parameters = normalizePluginParameters({
      defaultConnection: {
        endpoint: 'https://default.example/graphql',
        token: 'default-token',
        marketId: 1,
      },
      connectionsByEnvironment: {},
    });

    expect(resolveConnection(parameters)).toEqual({
      endpoint: 'https://default.example/graphql',
      token: 'default-token',
    });
  });

  it('keeps a complete legacy environment connection when the default was empty', () => {
    expect(
      normalizePluginParameters({
        defaultConnection: {},
        connectionsByEnvironment: {
          sandbox: {
            endpoint: 'https://sandbox.example/graphql',
            token: 'sandbox-token',
          },
        },
      }),
    ).toEqual({
      paramsVersion: '2',
      endpoint: 'https://sandbox.example/graphql',
      token: 'sandbox-token',
    });
  });
});

describe('Centra connection validation', () => {
  it('requires a valid endpoint and token', () => {
    expect(validateConnection({}).errors).toEqual({
      endpoint: 'Enter the Centra Storefront GraphQL endpoint.',
      token: 'Enter the no-session Storefront API token.',
    });
    expect(
      isConnectionComplete({
        ...EMPTY_CONNECTION,
        endpoint: 'https://example.com/graphql',
        token: 'token',
      }),
    ).toBe(true);
  });

  it('requires HTTPS except for local development', () => {
    expect(validateEndpoint('http://example.com/graphql')).toContain('HTTPS');
    expect(validateEndpoint('http://localhost:4000/graphql')).toBeNull();
    expect(validateEndpoint('https://example.com/graphql')).toBeNull();
  });

  it('rejects embedded URL credentials and fragments', () => {
    expect(validateEndpoint('https://user:pass@example.com/graphql')).toContain(
      'credentials',
    );
    expect(validateEndpoint('https://example.com/graphql#token')).toContain(
      'fragment',
    );
  });
});
