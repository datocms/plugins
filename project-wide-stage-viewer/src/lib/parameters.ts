import type { PluginParameters, StageMenuItem } from '../types';

/** Used when an entry has no icon of its own (the FA 6 name of the old `tasks`). */
export const DEFAULT_ICON = 'list-check';

const PAGE_ID_PATTERN = /^wf\.([^.]+)\.st\.([^.]+)$/;
/**
 * Earlier versions used colons. The dashboard reads a colon in a page path as
 * a route parameter, so every stage entry looked active at once. Links saved
 * with the old format still open.
 */
const LEGACY_PAGE_ID_PATTERN = /^wf:(.+)__st:(.+)$/;

/** Font Awesome 5 names the previous settings screen offered, renamed in FA 6. */
const FA5_ICON_RENAMES: Record<string, string> = {
  tasks: 'list-check',
  'check-circle': 'circle-check',
  edit: 'pen-to-square',
  'list-alt': 'rectangle-list',
  'play-circle': 'circle-play',
  'project-diagram': 'diagram-project',
  'sticky-note': 'note-sticky',
  stream: 'bars-staggered',
  'thermometer-half': 'temperature-half',
  tools: 'screwdriver-wrench',
};

export function buildPageId(workflowId: string, stageId: string): string {
  return `wf.${workflowId}.st.${stageId}`;
}

/** The workflow and stage a page ID points to, or null for other pages. */
export function parseStagePageId(
  pageId: string,
): { workflowId: string; stageId: string } | null {
  const match =
    PAGE_ID_PATTERN.exec(pageId) ?? LEGACY_PAGE_ID_PATTERN.exec(pageId);
  return match ? { workflowId: match[1], stageId: match[2] } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

function readMenuItem(raw: unknown): StageMenuItem | null {
  if (!isRecord(raw)) return null;

  const workflowId = nonEmptyString(raw.workflowId);
  const stageId = nonEmptyString(raw.stageId);
  if (!workflowId || !stageId) return null;

  const icon = nonEmptyString(raw.icon);
  return {
    id: buildPageId(workflowId, stageId),
    workflowId,
    workflowName: nonEmptyString(raw.workflowName) ?? workflowId,
    stageId,
    stageName: nonEmptyString(raw.stageName) ?? stageId,
    label: nonEmptyString(raw.label),
    icon: icon ? (FA5_ICON_RENAMES[icon] ?? icon) : undefined,
  };
}

/** Reads the saved entries, dropping malformed ones and duplicates. */
export function readMenuItems(parameters: unknown): StageMenuItem[] {
  const raw = isRecord(parameters) ? parameters.menuItems : undefined;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const items: StageMenuItem[] = [];
  for (const entry of raw) {
    const item = readMenuItem(entry);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

/** Strips empty optional keys so saved parameters stay minimal. */
export function serializeMenuItems(items: StageMenuItem[]): PluginParameters {
  return {
    menuItems: items.map(({ label, icon, ...rest }) => ({
      ...rest,
      ...(label?.trim() ? { label: label.trim() } : {}),
      ...(icon?.trim() ? { icon: icon.trim() } : {}),
    })),
  };
}

/**
 * Sidebar labels must be unique, so a stage name shared by two workflows gets
 * the workflow name after it.
 */
export function sidebarLabels(items: StageMenuItem[]): string[] {
  const base = items.map((item) => item.label ?? item.stageName);
  const counts = new Map<string, number>();
  for (const label of base) counts.set(label, (counts.get(label) ?? 0) + 1);

  const used = new Set<string>();
  return items.map((item, index) => {
    let label = base[index];
    if ((counts.get(label) ?? 0) > 1) label = `${label} (${item.workflowName})`;

    let unique = label;
    for (let n = 2; used.has(unique); n += 1) unique = `${label} ${n}`;
    used.add(unique);
    return unique;
  });
}
