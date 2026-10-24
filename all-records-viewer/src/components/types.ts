import type { PublicationStatus } from '../types';

/** One record as the table shows it */
export type TableRecord = {
  id: string;
  /** The presentation title, or a fallback that names the record */
  title: string;
  imageUrl?: string | null;
  /** The name of the model */
  model: string;
  status: PublicationStatus;
  statusLabel: string;
  /** ISO 8601 */
  updatedAt: string | null;
  /** ISO 8601 */
  createdAt: string | null;
  publishedValid?: boolean | null;
  currentValid?: boolean | null;
  draftModeActive?: boolean | null;
  /** The path of the record editor */
  url: string;
};
