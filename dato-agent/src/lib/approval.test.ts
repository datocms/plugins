import { describe, expect, it } from 'vitest';
import {
  READ_ONLY_REJECTION_MESSAGE,
  validateApprovalScope,
  validateMcpToolCall,
} from './approval';

const sandbox = {
  siteId: 'site-123',
  environment: 'staging',
  isEnvironmentPrimary: false,
};

function scriptArguments(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    site_id: 'site-123',
    environment: 'staging',
    name: 'script://dato-agent/site-123/staging/update-title.ts',
    body: {
      mode: 'full',
      content: 'await client.items.update("item-1", { title: "New" });',
    },
    method_tokens: ['method-token'],
    ...overrides,
  };
}

describe('validateMcpToolCall', () => {
  it('requires editor approval for a fully reviewable unsafe script', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'upsert_and_execute_unsafe_script',
          serverLabel: 'datocms',
          arguments: JSON.stringify(scriptArguments()),
        },
        sandbox,
      ),
    ).toMatchObject({
      allowed: true,
      disposition: 'require_user_approval',
    });
  });

  it('blocks every unsafe script in Read Only mode, including no_execute', () => {
    for (const noExecute of [undefined, false, true]) {
      expect(
        validateMcpToolCall(
          {
            name: 'upsert_and_execute_unsafe_script',
            serverLabel: 'datocms',
            arguments: JSON.stringify(
              scriptArguments({
                ...(noExecute === undefined ? {} : { no_execute: noExecute }),
              }),
            ),
          },
          sandbox,
          { readOnly: true },
        ),
      ).toEqual({
        allowed: false,
        reason: READ_ONLY_REJECTION_MESSAGE,
      });
    }
  });

  it('keeps safe scripts available in Read Only mode', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'upsert_and_execute_safe_script',
          serverLabel: 'datocms',
          arguments: JSON.stringify(scriptArguments()),
        },
        sandbox,
        { readOnly: true },
      ),
    ).toMatchObject({ allowed: true, disposition: 'auto_approve' });
  });

  it('auto-approves read and safe calls only after host validation', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'get_schema',
          serverLabel: 'datocms',
          arguments: JSON.stringify({
            site_id: 'site-123',
            environment: 'staging',
            filter_by_type: 'models_only',
          }),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: true, disposition: 'auto_approve' });

    expect(
      validateMcpToolCall(
        {
          name: 'upsert_and_execute_safe_script',
          serverLabel: 'datocms',
          arguments: JSON.stringify(scriptArguments()),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: true, disposition: 'auto_approve' });

    expect(
      validateMcpToolCall(
        {
          name: 'get_api_methods',
          serverLabel: 'datocms',
          arguments: JSON.stringify({
            methods: [{ resource: 'items', method: 'rawList' }],
          }),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: true, disposition: 'auto_approve' });

    for (const request of [
      { name: 'list_api_resources', arguments: '{}' },
      { name: 'whoami', arguments: '{}' },
      {
        name: 'view_script',
        arguments: JSON.stringify({
          name: 'script://dato-agent/site-123/staging/read.ts',
          start_line: 1,
          limit: 20,
        }),
      },
    ]) {
      expect(validateMcpToolCall(request, sandbox)).toMatchObject({
        allowed: true,
        disposition: 'auto_approve',
      });
    }
  });

  it('blocks cross-project and cross-environment operations', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'get_schema',
          arguments: JSON.stringify({
            site_id: 'another-site',
            environment: 'staging',
          }),
        },
        sandbox,
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('different DatoCMS project'),
    });

    expect(
      validateMcpToolCall(
        {
          name: 'upsert_and_execute_safe_script',
          arguments: JSON.stringify(
            scriptArguments({ environment: 'production' }),
          ),
        },
        sandbox,
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('different environment'),
    });
  });

  it('requires primary-environment operations to omit environment entirely', () => {
    const primary = {
      siteId: 'site-123',
      environment: 'main',
      isEnvironmentPrimary: true,
    };

    expect(
      validateMcpToolCall(
        {
          name: 'get_schema',
          arguments: JSON.stringify({
            site_id: 'site-123',
            environment: null,
          }),
        },
        primary,
      ),
    ).toMatchObject({ allowed: false });
    expect(
      validateMcpToolCall(
        {
          name: 'get_schema',
          arguments: JSON.stringify({ site_id: 'site-123' }),
        },
        primary,
      ),
    ).toMatchObject({ allowed: true, disposition: 'auto_approve' });
  });

  it('blocks scripts outside the current agent namespace', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'view_script',
          arguments: JSON.stringify({
            name: 'script://another-plugin/private.ts',
          }),
        },
        sandbox,
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('protected'),
    });

    expect(
      validateMcpToolCall(
        {
          name: 'upsert_and_execute_safe_script',
          arguments: JSON.stringify(
            scriptArguments({
              name: 'script://dato-agent/another-site/staging/read.ts',
            }),
          ),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: false });
  });

  it('requires unsafe approvals to contain full source, never a patch', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'upsert_and_execute_unsafe_script',
          arguments: JSON.stringify(
            scriptArguments({
              body: {
                mode: 'patch',
                replacements: [{ old_str: 'Old', new_str: 'New' }],
              },
            }),
          ),
        },
        sandbox,
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('complete script body'),
    });
  });

  it('rejects unexpected servers, tools, and malformed arguments', () => {
    expect(
      validateMcpToolCall(
        {
          name: 'get_schema',
          serverLabel: 'untrusted',
          arguments: JSON.stringify({
            site_id: 'site-123',
            environment: 'staging',
          }),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: false });
    expect(
      validateMcpToolCall(
        { name: 'search_projects', arguments: '{}' },
        sandbox,
      ),
    ).toMatchObject({ allowed: false });
    expect(
      validateMcpToolCall(
        { name: 'whoami', arguments: '{"unexpected":true}' },
        sandbox,
      ),
    ).toMatchObject({ allowed: false });
  });
});

describe('validateApprovalScope', () => {
  it('accepts only host-validated unsafe scripts for editor approval', () => {
    expect(
      validateApprovalScope(
        {
          name: 'upsert_and_execute_unsafe_script',
          arguments: JSON.stringify(scriptArguments()),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: true });

    expect(
      validateApprovalScope(
        {
          name: 'get_schema',
          arguments: JSON.stringify({
            site_id: 'site-123',
            environment: 'staging',
          }),
        },
        sandbox,
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('does not require editor approval'),
    });
  });

  it('rejects a pending unsafe approval when Read Only is enabled', () => {
    expect(
      validateApprovalScope(
        {
          name: 'upsert_and_execute_unsafe_script',
          arguments: JSON.stringify(scriptArguments()),
        },
        sandbox,
        { readOnly: true },
      ),
    ).toEqual({
      allowed: false,
      reason: READ_ONLY_REJECTION_MESSAGE,
    });
  });

  it('rejects scripts from another conversation namespace', () => {
    const sessionScope = {
      ...sandbox,
      scriptSessionId: 'conversation:abc',
    };
    const sessionScript = scriptArguments({
      name: 'script://dato-agent/site-123/staging/conversation%3Aabc/update-title.ts',
    });

    expect(
      validateApprovalScope(
        {
          name: 'upsert_and_execute_unsafe_script',
          arguments: JSON.stringify(sessionScript),
        },
        sessionScope,
      ),
    ).toMatchObject({ allowed: true });
    expect(
      validateApprovalScope(
        {
          name: 'upsert_and_execute_unsafe_script',
          arguments: JSON.stringify(sessionScript),
        },
        sandbox,
      ),
    ).toMatchObject({ allowed: true });
    expect(
      validateApprovalScope(
        {
          name: 'upsert_and_execute_unsafe_script',
          arguments: JSON.stringify(scriptArguments()),
        },
        sessionScope,
      ),
    ).toMatchObject({ allowed: false });
  });
});
