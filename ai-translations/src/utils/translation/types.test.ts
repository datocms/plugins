/**
 * Tests for types.ts
 * Tests timeout signal creation, ProviderError class, and type guards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTimeoutSignal,
  ProviderError,
  isProviderError,
  hasStatusCode,
  DEFAULT_API_TIMEOUT_MS,
} from './types';

describe('types.ts', () => {
  describe('DEFAULT_API_TIMEOUT_MS', () => {
    it('should be 2 minutes (120000ms)', () => {
      expect(DEFAULT_API_TIMEOUT_MS).toBe(120000);
    });
  });

  describe('createTimeoutSignal', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return an abort signal and cleanup function', () => {
      const result = createTimeoutSignal(1000);

      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('cleanup');
      expect(result.signal).toBeInstanceOf(AbortSignal);
      expect(typeof result.cleanup).toBe('function');
    });

    it('should abort after timeout expires', () => {
      const { signal } = createTimeoutSignal(1000);

      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(999);
      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
    });

    it('should set abort reason to TimeoutError', () => {
      const { signal } = createTimeoutSignal(1000);

      vi.advanceTimersByTime(1000);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(DOMException);
      expect((signal.reason as DOMException).name).toBe('TimeoutError');
    });

    it('cleanup should prevent timeout from firing', () => {
      const { signal, cleanup } = createTimeoutSignal(1000);

      cleanup();
      vi.advanceTimersByTime(2000);

      expect(signal.aborted).toBe(false);
    });

    it('should abort when external signal is already aborted', () => {
      const externalController = new AbortController();
      externalController.abort('external reason');

      const { signal } = createTimeoutSignal(1000, externalController.signal);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe('external reason');
    });

    it('should abort when external signal aborts before timeout', () => {
      const externalController = new AbortController();
      const { signal } = createTimeoutSignal(1000, externalController.signal);

      expect(signal.aborted).toBe(false);

      externalController.abort('user cancelled');

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe('user cancelled');
    });

    it('should clean up event listener on external signal', () => {
      const externalController = new AbortController();
      const removeEventListenerSpy = vi.spyOn(
        externalController.signal,
        'removeEventListener'
      );

      const { cleanup } = createTimeoutSignal(1000, externalController.signal);
      cleanup();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'abort',
        expect.any(Function)
      );
    });
  });

  describe('ProviderError', () => {
    it('should create an error with message only', () => {
      const error = new ProviderError('Something went wrong');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.message).toBe('Something went wrong');
      expect(error.name).toBe('ProviderError');
      expect(error.status).toBeUndefined();
      expect(error.vendor).toBeUndefined();
    });

    it('should create an error with status code', () => {
      const error = new ProviderError('Rate limited', 429);

      expect(error.message).toBe('Rate limited');
      expect(error.status).toBe(429);
      expect(error.vendor).toBeUndefined();
    });

    it('should create an error with status and vendor', () => {
      const error = new ProviderError('Auth failed', 401, 'openai');

      expect(error.message).toBe('Auth failed');
      expect(error.status).toBe(401);
      expect(error.vendor).toBe('openai');
    });

    it('should work with all vendor types', () => {
      const vendors = ['openai', 'google', 'anthropic', 'deepl'] as const;

      vendors.forEach((vendor) => {
        const error = new ProviderError('Test', 500, vendor);
        expect(error.vendor).toBe(vendor);
      });
    });
  });

  describe('isProviderError', () => {
    it('should return true for ProviderError instances', () => {
      const error = new ProviderError('Test error');
      expect(isProviderError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('Regular error');
      expect(isProviderError(error)).toBe(false);
    });

    it('should return false for non-error objects', () => {
      expect(isProviderError({ message: 'fake error' })).toBe(false);
      expect(isProviderError(null)).toBe(false);
      expect(isProviderError(undefined)).toBe(false);
      expect(isProviderError('string error')).toBe(false);
      expect(isProviderError(42)).toBe(false);
    });
  });

  describe('hasStatusCode', () => {
    it('should return true for objects with numeric status', () => {
      expect(hasStatusCode({ status: 404 })).toBe(true);
      expect(hasStatusCode({ status: 500, message: 'error' })).toBe(true);
    });

    it('should return false for objects without status', () => {
      expect(hasStatusCode({ message: 'error' })).toBe(false);
      expect(hasStatusCode({})).toBe(false);
    });

    it('should return false for non-numeric status', () => {
      expect(hasStatusCode({ status: '404' })).toBe(false);
      expect(hasStatusCode({ status: null })).toBe(false);
      expect(hasStatusCode({ status: undefined })).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(hasStatusCode(null)).toBe(false);
      expect(hasStatusCode(undefined)).toBe(false);
      expect(hasStatusCode('string')).toBe(false);
      expect(hasStatusCode(123)).toBe(false);
    });

    it('should work with ProviderError', () => {
      const errorWithStatus = new ProviderError('Error', 429);
      const errorWithoutStatus = new ProviderError('Error');

      expect(hasStatusCode(errorWithStatus)).toBe(true);
      expect(hasStatusCode(errorWithoutStatus)).toBe(false);
    });
  });
});
