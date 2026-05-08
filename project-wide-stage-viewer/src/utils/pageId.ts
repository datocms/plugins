import type { StageMenuItem } from '../types';

/**
 * Page-id namespace prefix used by every sidebar item this plugin contributes.
 * Kept short and URL-safe so it doesn't collide with reserved router characters.
 */
export const PAGE_ID_PREFIX = 'pwsv-';

/**
 * Build a deterministic, URL-safe page id for a configured stage menu item.
 *
 * The original implementation embedded colons (`wf:X__st:Y`) which the DatoCMS
 * sidebar interpreted as route parameters, causing every item in this plugin
 * to appear highlighted at the same time. Deriving the id from the stored
 * `workflowId` + `stageId` keeps existing user configurations working — we
 * never read `item.id` back when matching.
 */
export const menuItemPageId = (item: StageMenuItem): string =>
  `${PAGE_ID_PREFIX}${item.workflowId}-${item.stageId}`;
