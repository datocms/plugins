import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyTextToClipboard,
  DIAGNOSTICS_SCHEMA_VERSION,
  serializeDiagnostics,
} from './diagnostics';

function setClipboard(
  value: { writeText: (text: string) => unknown } | undefined,
) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
}

function setExecCommand(value: ((command: string) => boolean) | undefined) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setClipboard(undefined);
  setExecCommand(undefined);
  document.body.replaceChildren();
});

describe('serializeDiagnostics', () => {
  it('produces deterministic pretty JSON while preserving raw diagnostic values', () => {
    const first = {
      token: 'dato_oauth_secret',
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      prompt: 'Change record 178178740',
      arguments: { z: true, apiKey: 'sk-secret', a: false },
    };
    const second = {
      arguments: { a: false, apiKey: 'sk-secret', z: true },
      prompt: 'Change record 178178740',
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      token: 'dato_oauth_secret',
    };

    expect(serializeDiagnostics(first)).toBe(serializeDiagnostics(second));
    expect(serializeDiagnostics(first)).toBe(`{
  "arguments": {
    "a": false,
    "apiKey": "sk-secret",
    "z": true
  },
  "prompt": "Change record 178178740",
  "schemaVersion": 1,
  "token": "dato_oauth_secret"
}`);
  });

  it('handles errors, BigInt, Map, Set, circular references, and unsupported values', () => {
    const cause = new Error('Provider request failed');
    const error = new Error('Turn failed', { cause });
    Object.assign(error, { status: 500n });

    const diagnostics: Record<string, unknown> = {
      error,
      map: new Map<unknown, unknown>([['request', { recordId: 'record-1' }]]),
      set: new Set(['one', 'two']),
      missing: undefined,
      callback: function retryTurn() {},
      symbol: Symbol('private'),
      notANumber: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
    };
    diagnostics.circular = diagnostics;

    const parsed = JSON.parse(serializeDiagnostics(diagnostics));

    expect(parsed.error).toMatchObject({
      $type: 'Error',
      name: 'Error',
      message: 'Turn failed',
      cause: {
        $type: 'Error',
        name: 'Error',
        message: 'Provider request failed',
      },
      status: '500n',
    });
    expect(parsed.error.stack).toContain('Turn failed');
    expect(parsed.map).toEqual({
      $type: 'Map',
      entries: [['request', { recordId: 'record-1' }]],
    });
    expect(parsed.set).toEqual({
      $type: 'Set',
      values: ['one', 'two'],
    });
    expect(parsed).toMatchObject({
      callback: '[Function retryTurn]',
      circular: '[Circular $]',
      infinity: '[Infinity]',
      missing: '[undefined]',
      notANumber: '[NaN]',
      symbol: '[Symbol(private)]',
    });
  });

  it('does not throw for values whose properties cannot be inspected', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => serializeDiagnostics(proxy)).not.toThrow();
    expect(serializeDiagnostics(proxy)).toContain('[Unserializable:');
  });
});

describe('copyTextToClipboard', () => {
  it('uses the Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn(() => true);
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await copyTextToClipboard('full diagnostics');

    expect(writeText).toHaveBeenCalledWith('full diagnostics');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to an iframe-local textarea and restores focus', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    const writeText = vi.fn().mockRejectedValue(new Error('Not allowed'));
    const execCommand = vi.fn((command: string) => {
      const textarea = document.querySelector('textarea');
      expect(command).toBe('copy');
      expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
      expect(textarea).toHaveValue('raw token: secret');
      expect(textarea).toHaveAttribute('readonly');
      return true;
    });
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await copyTextToClipboard('raw token: secret');

    expect(execCommand).toHaveBeenCalledOnce();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('throws and still cleans up when both copy mechanisms fail', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error('Not allowed')),
    });
    setExecCommand(vi.fn(() => false));

    await expect(copyTextToClipboard('diagnostics')).rejects.toThrow(
      'Could not copy diagnostics to the clipboard',
    );
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
