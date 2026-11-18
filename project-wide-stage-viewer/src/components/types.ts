import type { RecordRowPresentation } from 'datocms-react-ui/RecordRow';
import type { PublicationStatus } from '../types';

/** One record as the table shows it */
export type TableRecord = {
  id: string;
  /** The record as DatoCMS presents it: its title, image, validity and status */
  presentation: RecordRowPresentation;
  /** The name of the model */
  model: string;
  status: PublicationStatus;
  /** ISO 8601 */
  updatedAt: string | null;
  /** ISO 8601 */
  createdAt: string | null;
  /** The path of the record editor */
  url: string;
};
