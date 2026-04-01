import {
  buildPluginParams,
  getCommentsModelIdForEnvironment,
  PLUGIN_PARAMS_DEFAULTS,
  parsePluginParams,
  setCommentsModelIdForEnvironment,
} from '@utils/pluginParams';
import { describe, expect, it } from 'vitest';

describe('plugin parameter helpers', () => {
  describe('parsePluginParams', () => {
    it('returns defaults for invalid input', () => {
      expect(parsePluginParams(null)).toEqual(PLUGIN_PARAMS_DEFAULTS);
      expect(parsePluginParams('invalid')).toEqual(PLUGIN_PARAMS_DEFAULTS);
    });

    it('trims the CDA token and preserves booleans', () => {
      expect(
        parsePluginParams({
          cdaToken: '  token-123  ',
          commentsModelIdsByEnvironment: {
            main: '  model-1  ',
            empty: '   ',
          },
          debugLoggingEnabled: true,
          migrationCompleted: true,
          realTimeUpdatesEnabled: false,
        }),
      ).toEqual({
        cdaToken: 'token-123',
        commentsModelIdsByEnvironment: {
          main: 'model-1',
        },
        debugLoggingEnabled: true,
        migrationCompleted: true,
        realTimeUpdatesEnabled: false,
      });
    });
  });

  describe('buildPluginParams', () => {
    it('fills missing values from defaults', () => {
      expect(buildPluginParams({ realTimeUpdatesEnabled: false })).toEqual({
        cdaToken: '',
        commentsModelIdsByEnvironment: {},
        debugLoggingEnabled: false,
        migrationCompleted: false,
        realTimeUpdatesEnabled: false,
      });
    });

    it('trims whitespace-only tokens to an empty string', () => {
      expect(
        buildPluginParams({
          cdaToken: '   ',
          commentsModelIdsByEnvironment: {
            primary: '  model-1  ',
            blank: '   ',
          },
          debugLoggingEnabled: true,
          migrationCompleted: true,
          realTimeUpdatesEnabled: true,
        }),
      ).toEqual({
        cdaToken: '',
        commentsModelIdsByEnvironment: {
          primary: 'model-1',
        },
        debugLoggingEnabled: true,
        migrationCompleted: true,
        realTimeUpdatesEnabled: true,
      });
    });
  });

  describe('environment model helpers', () => {
    it('returns the stored model ID for the current environment', () => {
      expect(
        getCommentsModelIdForEnvironment(
          buildPluginParams({
            commentsModelIdsByEnvironment: {
              primary: 'model-1',
            },
          }),
          'primary',
        ),
      ).toBe('model-1');
    });

    it('stores the model ID under the requested environment', () => {
      expect(
        setCommentsModelIdForEnvironment(
          buildPluginParams({
            commentsModelIdsByEnvironment: {
              primary: 'model-1',
            },
          }),
          'sandbox',
          'model-2',
        ),
      ).toEqual(
        buildPluginParams({
          commentsModelIdsByEnvironment: {
            primary: 'model-1',
            sandbox: 'model-2',
          },
        }),
      );
    });
  });
});
