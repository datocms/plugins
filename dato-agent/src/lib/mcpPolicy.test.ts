import { describe, expect, it } from 'vitest';
import {
  createDatoAgentScriptNamespace,
  createDatoCmsMcpTool,
  DATOCMS_MCP_ALLOWED_TOOLS,
  DATOCMS_MCP_APPROVAL_POLICY,
  DATOCMS_MCP_EXCLUDED_TOOLS,
  DATOCMS_MCP_UNSAFE_SCRIPT_TOOL,
  DATOCMS_MCP_URL,
  datoCmsMcpAllowedTools,
  isDatoCmsMcpToolAllowed,
} from './mcpPolicy';

describe('DatoCMS MCP policy', () => {
  it('uses the exact remote MCP URL and routes every call through the host', () => {
    const tool = createDatoCmsMcpTool('  oauth-token  ');

    expect(tool.server_url).toBe('https://mcp.datocms.com/');
    expect(DATOCMS_MCP_URL).toBe('https://mcp.datocms.com/');
    expect(tool.authorization).toBe('oauth-token');
    expect(tool.require_approval).toBe('always');
    expect(DATOCMS_MCP_APPROVAL_POLICY).toEqual(tool.require_approval);
  });

  it('uses an explicit allowlist without project search or issue reporting', () => {
    const tool = createDatoCmsMcpTool('oauth-token');

    expect(tool.allowed_tools).toEqual([...DATOCMS_MCP_ALLOWED_TOOLS]);
    for (const excludedTool of DATOCMS_MCP_EXCLUDED_TOOLS) {
      expect(tool.allowed_tools).not.toContain(excludedTool);
    }
  });

  it('removes only the unsafe script tool in Read Only mode', () => {
    const allowedTools = datoCmsMcpAllowedTools({ readOnly: true });
    const tool = createDatoCmsMcpTool('oauth-token', { readOnly: true });

    expect(allowedTools).toEqual(
      DATOCMS_MCP_ALLOWED_TOOLS.filter(
        (name) => name !== DATOCMS_MCP_UNSAFE_SCRIPT_TOOL,
      ),
    );
    expect(tool.allowed_tools).toEqual(allowedTools);
    expect(allowedTools).toContain('upsert_and_execute_safe_script');
    expect(allowedTools).not.toContain(DATOCMS_MCP_UNSAFE_SCRIPT_TOOL);
    expect(
      isDatoCmsMcpToolAllowed(DATOCMS_MCP_UNSAFE_SCRIPT_TOOL, {
        readOnly: true,
      }),
    ).toBe(false);
    expect(
      isDatoCmsMcpToolAllowed('upsert_and_execute_safe_script', {
        readOnly: true,
      }),
    ).toBe(true);
  });

  it('keeps the complete allowlist by default', () => {
    expect(datoCmsMcpAllowedTools()).toEqual([...DATOCMS_MCP_ALLOWED_TOOLS]);
    expect(isDatoCmsMcpToolAllowed(DATOCMS_MCP_UNSAFE_SCRIPT_TOOL)).toBe(true);
  });

  it('rejects a missing OAuth token', () => {
    expect(() => createDatoCmsMcpTool('   ')).toThrow(
      'A DatoCMS MCP access token is required.',
    );
  });

  it('creates a project and environment-specific script namespace', () => {
    expect(
      createDatoAgentScriptNamespace({
        siteId: 'site/123',
        environment: 'feature branch',
        isEnvironmentPrimary: false,
      }),
    ).toBe('script://dato-agent/site%2F123/feature%20branch/');
    expect(
      createDatoAgentScriptNamespace({
        siteId: 'site-123',
        environment: 'main',
        isEnvironmentPrimary: true,
      }),
    ).toBe('script://dato-agent/site-123/primary/');
  });

  it('isolates stored scripts by conversation when a session is present', () => {
    expect(
      createDatoAgentScriptNamespace({
        siteId: 'site-123',
        environment: 'main',
        isEnvironmentPrimary: true,
        scriptSessionId: 'conversation:abc/123',
      }),
    ).toBe('script://dato-agent/site-123/primary/conversation%3Aabc%2F123/');
  });
});
