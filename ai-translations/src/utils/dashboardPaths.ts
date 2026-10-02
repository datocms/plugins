/**
 * dashboardPaths.ts
 * -----------------
 * Paths inside the DatoCMS dashboard for `ctx.navigateTo`, prefixed with the
 * current sandbox environment when it isn't the primary one.
 */

type EnvironmentCtx = {
  environment: string;
  isEnvironmentPrimary: boolean;
};

export type EnvironmentNavigationCtx = EnvironmentCtx & {
  plugin: { id: string };
};

function environmentPrefix(ctx: EnvironmentCtx): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

/** This plugin's settings screen. */
export function buildPluginSettingsPath(ctx: EnvironmentNavigationCtx): string {
  return `${environmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`;
}

/** The "Locales & Timezone" settings screen. */
export function buildLocaleSettingsPath(ctx: EnvironmentCtx): string {
  return `${environmentPrefix(ctx)}/configuration/locales-and-timezone`;
}

/** The schema area, where models are created. */
export function buildSchemaPath(ctx: EnvironmentCtx): string {
  return `${environmentPrefix(ctx)}/schema`;
}
