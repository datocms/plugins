import type { Tool } from 'openai/resources/responses/responses';

export const DATOCMS_MCP_URL = 'https://mcp.datocms.com/' as const;
export const DATOCMS_MCP_SERVER_LABEL = 'datocms' as const;

/**
 * Project discovery and API-issue reporting are intentionally omitted. The agent
 * is pinned to the project supplied by the plugin context and must not inspect or
 * act on other projects.
 */
export const DATOCMS_MCP_ALLOWED_TOOLS = [
  'list_api_resources',
  'get_api_methods',
  'get_schema',
  'upsert_and_execute_safe_script',
  'upsert_and_execute_unsafe_script',
  'view_script',
  'whoami',
] as const;

export const DATOCMS_MCP_EXCLUDED_TOOLS = [
  'search_projects',
  'report_api_issue',
] as const;

/**
 * Route every remote call through the host. The runtime auto-approves only
 * calls that it has parsed and validated against the current DatoCMS context;
 * unsafe scripts remain explicitly editor-approved.
 */
export const DATOCMS_MCP_APPROVAL_POLICY =
  'always' as const satisfies NonNullable<Tool.Mcp['require_approval']>;

export interface DatoCmsMcpProjectScope {
  siteId: string;
  environment: string;
  isEnvironmentPrimary: boolean;
  scriptSessionId?: string;
}

export function createDatoAgentScriptNamespace(
  scope: DatoCmsMcpProjectScope,
): string {
  const siteId = encodeURIComponent(scope.siteId.trim());
  const environment = scope.isEnvironmentPrimary
    ? 'primary'
    : encodeURIComponent(scope.environment.trim());
  const scriptSessionId = scope.scriptSessionId?.trim().slice(0, 128);
  const sessionSegment = scriptSessionId
    ? `${encodeURIComponent(scriptSessionId)}/`
    : '';

  return `script://dato-agent/${siteId}/${environment}/${sessionSegment}`;
}

export function createDatoCmsMcpTool(accessToken: string): Tool.Mcp {
  const normalizedAccessToken = accessToken.trim();

  if (!normalizedAccessToken) {
    throw new Error('A DatoCMS MCP access token is required.');
  }

  return {
    type: 'mcp',
    server_label: DATOCMS_MCP_SERVER_LABEL,
    server_description:
      'DatoCMS project schema and content operations for the current project and environment.',
    server_url: DATOCMS_MCP_URL,
    authorization: normalizedAccessToken,
    allowed_tools: [...DATOCMS_MCP_ALLOWED_TOOLS],
    require_approval: DATOCMS_MCP_APPROVAL_POLICY,
  };
}
