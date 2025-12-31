import { describe, it, expect } from 'vitest';
import {
  categorizeSubscriptionError,
  categorizeGeneralError,
  normalizeError,
} from '@utils/errorCategorization';

describe('categorizeSubscriptionError', () => {
  describe('token_expired', () => {
    it('categorizes token errors', () => {
      const error = new Error('Invalid token provided');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
      expect(result.message).toContain('CDA token');
    });

    it('categorizes unauthorized errors', () => {
      const error = new Error('Unauthorized access');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
    });

    it('categorizes 401 errors', () => {
      const error = new Error('HTTP 401 response');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
    });

    it('categorizes 403 errors', () => {
      const error = new Error('HTTP 403 forbidden');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
    });

    it('categorizes authentication errors', () => {
      const error = new Error('Authentication failed');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
    });

    it('categorizes forbidden errors', () => {
      const error = new Error('Forbidden access');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
    });
  });

  describe('network_error', () => {
    it('categorizes network errors', () => {
      const error = new Error('Network request failed');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
      expect(result.message).toContain('Connection lost');
    });

    it('categorizes fetch errors', () => {
      const error = new Error('Fetch failed');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
    });

    it('categorizes connection errors', () => {
      const error = new Error('Connection refused');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
    });

    it('categorizes timeout errors', () => {
      const error = new Error('Request timeout');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
    });

    it('categorizes socket errors', () => {
      const error = new Error('Socket error');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
    });

    it('categorizes ECONNREFUSED errors', () => {
      const error = new Error('ECONNREFUSED');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
    });
  });

  describe('graphql_error', () => {
    it('categorizes graphql errors', () => {
      const error = new Error('GraphQL error occurred');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('graphql_error');
      expect(result.message).toContain('Query error');
    });

    it('categorizes query errors', () => {
      const error = new Error('Query failed');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('graphql_error');
    });

    it('categorizes syntax errors', () => {
      const error = new Error('Syntax error in query');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('graphql_error');
    });

    it('categorizes validation errors', () => {
      const error = new Error('Validation failed');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('graphql_error');
    });
  });

  describe('unknown', () => {
    it('returns unknown for unrecognized errors', () => {
      const error = new Error('Something went wrong');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('unknown');
      expect(result.message).toContain('Sync error');
    });

    it('returns unknown for empty error message', () => {
      const error = new Error('');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('unknown');
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase error messages', () => {
      const error = new Error('UNAUTHORIZED ACCESS');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('token_expired');
    });

    it('handles mixed case error messages', () => {
      const error = new Error('NetWork Error Occurred');
      const result = categorizeSubscriptionError(error);

      expect(result.type).toBe('network_error');
    });
  });
});

describe('categorizeGeneralError', () => {
  describe('permission_denied', () => {
    it('categorizes forbidden errors', () => {
      const error = new Error('Access forbidden');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('permission_denied');
      expect(result.message).toContain('Permission denied');
    });

    it('categorizes 401 errors', () => {
      const error = new Error('HTTP 401');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('permission_denied');
    });

    it('categorizes 403 errors', () => {
      const error = new Error('HTTP 403');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('permission_denied');
    });
  });

  describe('network_error', () => {
    it('categorizes network errors', () => {
      const error = new Error('Network error');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('network_error');
      expect(result.message).toContain('Check your connection');
    });

    it('categorizes fetch errors', () => {
      const error = new Error('Fetch failed');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('network_error');
    });

    it('categorizes timeout errors', () => {
      const error = new Error('Request timeout');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('network_error');
    });
  });

  describe('unknown', () => {
    it('returns unknown for unrecognized errors', () => {
      const error = new Error('Something went wrong');
      const result = categorizeGeneralError(error);

      expect(result.type).toBe('unknown');
      expect(result.message).toContain('Failed to load data');
    });
  });
});

describe('normalizeError', () => {
  describe('Error instances', () => {
    it('returns Error instances unchanged', () => {
      const error = new Error('Test error');
      const result = normalizeError(error);

      expect(result).toBe(error);
    });

    it('preserves error message', () => {
      const error = new Error('Original message');
      const result = normalizeError(error);

      expect(result.message).toBe('Original message');
    });
  });

  describe('objects with message property', () => {
    it('creates Error from object with message', () => {
      const error = { message: 'Object error' };
      const result = normalizeError(error);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('Object error');
    });

    it('ignores non-string message properties', () => {
      const error = { message: 123 };
      const result = normalizeError(error);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('[object Object]');
    });
  });

  describe('primitive values', () => {
    it('converts string to Error', () => {
      const result = normalizeError('String error');

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('String error');
    });

    it('converts number to Error', () => {
      const result = normalizeError(404);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('404');
    });

    it('converts undefined to Error', () => {
      const result = normalizeError(undefined);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('undefined');
    });

    it('converts null to Error', () => {
      const result = normalizeError(null);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('null');
    });

    it('converts boolean to Error', () => {
      const result = normalizeError(false);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('false');
    });
  });

  describe('edge cases', () => {
    it('handles empty object', () => {
      const result = normalizeError({});

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('[object Object]');
    });

    it('handles array', () => {
      const result = normalizeError(['error1', 'error2']);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('error1,error2');
    });
  });
});
