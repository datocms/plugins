import { errorAdvice, isPermissionError, normalizeError } from '../data/errors';
import { formatNumber, formatRecordCount } from '../texts';
import type {
  BulkJobResult,
  BulkOperation,
  BulkOperationResult,
} from './types';

const pastTense: Record<BulkOperation, string> = {
  delete: 'deleted',
  publish: 'published',
  unpublish: 'unpublished',
  move_to_stage: 'moved',
};

const infinitive: Record<BulkOperation, string> = {
  delete: 'delete',
  publish: 'publish',
  unpublish: 'unpublish',
  move_to_stage: 'move',
};

export function normalizeBulkOperationResult(
  operation: BulkOperation,
  requested: number,
  result: BulkJobResult,
): BulkOperationResult {
  return {
    operation,
    requested,
    successful: result.meta.successful,
    failed: result.meta.failed,
  };
}

export function isPartialBulkResult(result: BulkOperationResult): boolean {
  return result.successful > 0 && result.failed > 0;
}

// The selected records that the action did not do: the ones already in the
// stage of a move need nothing more and leave the selection, the others stay
// selected
function othersSentences(
  locale: string,
  alreadyThere: number,
  stillSelected: number,
): string[] {
  const sentences: string[] = [];
  if (alreadyThere > 0) {
    const verb = alreadyThere === 1 ? 'was' : 'were';
    const count = formatNumber(locale, alreadyThere);
    sentences.push(
      stillSelected > 0
        ? `${count} ${verb} already there.`
        : `The other ${count} ${verb} already there.`,
    );
  }
  if (stillSelected > 0) {
    sentences.push(
      `The other ${formatNumber(locale, stillSelected)} ${
        stillSelected === 1 ? 'is' : 'are'
      } still selected.`,
    );
  }
  return sentences;
}

// Why the requests failed, in plain words: the role of the user, or what to
// do. Never the URL or the body of the request. Null when the records tell
// why: a job that reports only counts, or a request that the server turned
// down for these records (a 4xx other than 429: they are gone, or the API
// won't take them), which trying again doesn't fix.
function failureCause(
  operation: BulkOperation,
  error: unknown,
  count: number,
): string | null {
  if (error === undefined) return null;
  if (isPermissionError(error)) {
    return `Your role can't ${infinitive[operation]} ${count === 1 ? 'it' : 'them'}.`;
  }
  const { status } = normalizeError(error);
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    return null;
  }
  return errorAdvice(error);
}

/**
 * The toast at the end of an action: what was done, what failed and why (or
 * where to see why), or else what stays selected. `leftOut` is the number of
 * selected records that the action could not apply to, thus were not sent;
 * `alreadyThere` is how many of them were already in the stage of a move.
 * After a failure the toast does not count the selection: a batch that
 * failed in part stays selected as a whole, since the API gives only counts.
 * The counts have the separators of `locale`, as the bar and the questions.
 */
export function bulkResultMessage(
  result: BulkOperationResult,
  {
    locale = 'en',
    stageName,
    leftOut = 0,
    alreadyThere = 0,
  }: {
    locale?: string;
    stageName?: string;
    leftOut?: number;
    alreadyThere?: number;
  } = {},
): string {
  const past = pastTense[result.operation];
  const notDone = result.failed + (result.unprocessed ?? 0);
  const sentences: string[] = result.cancelled ? ['Stopped.'] : [];
  const cause =
    result.failed > 0
      ? failureCause(result.operation, result.error, notDone)
      : null;
  const end =
    result.failed > 0 && cause === null
      ? ': open the selected records to see why.'
      : '.';

  if (result.successful === 0) {
    sentences.push(`No records were ${past}${end}`);
  } else {
    const destination = stageName ? ` to “${stageName}”` : '';
    sentences.push(
      `${formatRecordCount(locale, result.successful)} ${past}${destination}.`,
    );
    if (result.failed > 0) {
      sentences.push(
        `${formatNumber(locale, notDone)} couldn't be ${past}${end}`,
      );
    } else {
      sentences.push(
        ...othersSentences(
          locale,
          alreadyThere,
          notDone + leftOut - alreadyThere,
        ),
      );
    }
  }

  if (cause) {
    sentences.push(cause);
  }

  return sentences.join(' ');
}

/** The alert of an action that failed before it could save anything */
export function bulkErrorMessage(
  operation: BulkOperation,
  error: unknown,
): string {
  if (isPermissionError(error)) {
    return `Your role can't ${infinitive[operation]} the selected records.`;
  }
  return `Couldn't ${infinitive[operation]} the selected records. ${errorAdvice(error)}`;
}
