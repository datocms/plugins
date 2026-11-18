import type {
  RecordRowModel,
  RecordRowPresentation,
} from 'datocms-react-ui/RecordRow';
import type { PublicationStatus } from '../types';

/** One record as the table shows it */
export type TableRecord = {
  id: string;
  /**
   * The title, the image and the validity of the record, as the title cell
   * shows them. It has no status: the Status column shows it.
   */
  presentation: RecordRowPresentation;
  /** The model of the record, for the validity of the title cell */
  recordModel: RecordRowModel;
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
