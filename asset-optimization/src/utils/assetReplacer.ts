/**
 * DatoCMS Asset Replacement Utility
 *
 * This module provides functions to replace existing assets in DatoCMS
 * with new optimized versions from a URL, with support for parallel processing
 * and rate limiting.
 *
 * @module assetReplacer
 */

import {
  ApiError,
  buildClient,
  type Client as CmaClient,
  type RawApiTypes,
} from '@datocms/cma-client-browser';

/**
 * Interface for the asset update response from DatoCMS
 */
type AssetUpdateResponse = RawApiTypes.UploadUpdateJobSchema;

/**
 * Interface for asset replacement task
 */
interface AssetReplacementTask {
  assetId: string;
  newImageUrl: string;
  filename?: string;
  retryCount: number;
  lastError?: Error;
}

/**
 * Configuration for the asset replacement
 */
interface AssetReplacerConfig {
  apiToken: string;
  environment: string;
  baseUrl?: string;
  concurrency?: number; // Number of concurrent replacements
  initialRetryDelay?: number; // Initial retry delay in ms
  maxRetryDelay?: number; // Maximum retry delay in ms
  retryBackoffFactor?: number; // Multiplier for each retry
}

/**
 * Sleep for a specified duration
 *
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay for retries
 *
 * @param {number} retryCount - Current retry attempt number
 * @param {number} initialDelay - Initial delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @param {number} backoffFactor - Multiplier for each retry
 * @returns {number} Delay in milliseconds for the next retry
 */
const calculateBackoff = (
  retryCount: number,
  initialDelay: number,
  maxDelay: number,
  backoffFactor: number,
): number => {
  const delay = initialDelay * backoffFactor ** retryCount;
  return Math.min(delay, maxDelay);
};

type RetryConfig = {
  retryCount: number;
  initialRetryDelay: number;
  maxRetryDelay: number;
  retryBackoffFactor: number;
};

const computeRateLimitDelay = (
  retryAfterHeader: string | undefined,
  retryConfig: RetryConfig,
): number => {
  const retryAfterSeconds = retryAfterHeader
    ? Number.parseInt(retryAfterHeader, 10)
    : 0;
  if (retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return calculateBackoff(
    retryConfig.retryCount,
    retryConfig.initialRetryDelay,
    retryConfig.maxRetryDelay,
    retryConfig.retryBackoffFactor,
  );
};

const createCmaClient = (
  apiToken: string,
  environment: string,
  baseUrl?: string,
): CmaClient =>
  buildClient({
    apiToken,
    environment,
    autoRetry: false,
    ...(baseUrl ? { baseUrl } : {}),
  });

const isRateLimitError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.response.status === 429;

const getRetryAfterHeader = (error: ApiError): string | undefined =>
  error.response.headers['retry-after'] ??
  error.response.headers['x-ratelimit-reset'];

const normalizeRequestHeaders = (
  headers: Record<string, unknown>,
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    }
  }

  return result;
};

const fetchAndUploadImageToS3 = async (
  newImageUrl: string,
  s3Url: string,
  s3Headers: Record<string, string>,
): Promise<void> => {
  const imageResponse = await fetch(newImageUrl);
  if (!imageResponse.ok) {
    throw new Error(
      `Failed to fetch image from URL: ${imageResponse.status} ${imageResponse.statusText}`,
    );
  }

  const imageBlob = await imageResponse.blob();
  const arrayBuffer = await imageBlob.arrayBuffer();
  const imageBuffer = new Uint8Array(arrayBuffer);

  const s3Response = await fetch(s3Url, {
    method: 'PUT',
    headers: {
      ...s3Headers,
      'Content-Length': imageBuffer.length.toString(),
    },
    body: imageBuffer,
  });

  if (!s3Response.ok) {
    throw new Error(
      `Failed to upload file to S3: ${s3Response.status} ${s3Response.statusText}`,
    );
  }
};

/**
 * Replaces an existing asset in DatoCMS with a new image from a URL.
 * Includes retries for rate limiting (429) errors.
 *
 * @param {string} assetId - The ID of the asset to replace
 * @param {string} newImageUrl - URL of the new image to replace the original with
 * @param {string} apiToken - DatoCMS API token
 * @param {string} environment - Environment for the DatoCMS API call
 * @param {string} [filename] - Optional custom filename for the replacement
 * @param {number} [retryCount=0] - Current retry attempt
 * @param {number} [initialRetryDelay=1000] - Initial retry delay in ms
 * @param {number} [maxRetryDelay=60000] - Maximum retry delay in ms
 * @param {number} [retryBackoffFactor=2] - Backoff factor for retries
 * @returns {Promise<AssetUpdateResponse>} The updated asset object from DatoCMS
 * @throws {Error} If the replacement fails after all retries
 */
async function replaceAssetFromUrl(
  assetId: string,
  newImageUrl: string,
  apiToken: string,
  environment: string,
  baseUrl?: string,
  filename?: string,
  retryCount = 0,
  initialRetryDelay = 1000,
  maxRetryDelay = 60000,
  retryBackoffFactor = 2,
): Promise<AssetUpdateResponse> {
  console.log(
    `Replacing DatoCMS asset ID ${assetId} with image from URL: ${newImageUrl}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
  );

  if (!assetId || !apiToken) {
    throw new Error(
      'Missing required parameters: assetId and apiToken are required',
    );
  }

  const retryConfig: RetryConfig = {
    retryCount,
    initialRetryDelay,
    maxRetryDelay,
    retryBackoffFactor,
  };

  const retryCall = async (increment = 1) => {
    return replaceAssetFromUrl(
      assetId,
      newImageUrl,
      apiToken,
      environment,
      baseUrl,
      filename,
      retryCount + increment,
      initialRetryDelay,
      maxRetryDelay,
      retryBackoffFactor,
    );
  };

  try {
    const client = createCmaClient(apiToken, environment, baseUrl);

    const uploadRequest = await client.uploadRequest.create({
      filename: filename || 'optimized-image.jpg',
    });

    await fetchAndUploadImageToS3(
      newImageUrl,
      uploadRequest.url,
      normalizeRequestHeaders(uploadRequest.request_headers),
    );

    const updateResponse = await client.uploads.rawUpdate(assetId, {
      data: {
        id: assetId,
        type: 'upload',
        attributes: {
          path: uploadRequest.id,
        },
      },
    });

    console.log('Asset replaced successfully:', updateResponse);
    return updateResponse;
  } catch (error) {
    if (isRateLimitError(error) && retryCount < 5) {
      const delayMs = computeRateLimitDelay(
        getRetryAfterHeader(error),
        retryConfig,
      );
      console.error(
        `Rate limit exceeded while replacing asset. Retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
      return retryCall();
    }

    console.error('Error replacing asset:', error);
    throw error;
  }
}

/**
 * Asset Replacer class for handling parallel replacements with rate limiting
 */
class AssetReplacer {
  private queue: AssetReplacementTask[] = [];
  private activeCount = 0;
  private config: AssetReplacerConfig;
  private processing = false;
  private completedCount = 0;
  private failedCount = 0;
  private resolvePromise:
    | ((value: { succeeded: number; failed: number }) => void)
    | null = null;

  /**
   * Creates a new AssetReplacer instance
   *
   * @param {AssetReplacerConfig} config - Configuration for asset replacement
   */
  constructor(config: AssetReplacerConfig) {
    this.config = {
      ...config,
      concurrency: config.concurrency || 3, // Default to 3 concurrent operations
      initialRetryDelay: config.initialRetryDelay || 1000,
      maxRetryDelay: config.maxRetryDelay || 60000,
      retryBackoffFactor: config.retryBackoffFactor || 2,
    };
  }

  /**
   * Add a task to the replacement queue
   *
   * @param {string} assetId - The ID of the asset to replace
   * @param {string} newImageUrl - URL of the new image
   * @param {string} [filename] - Optional custom filename
   */
  addTask(assetId: string, newImageUrl: string, filename?: string): void {
    this.queue.push({
      assetId,
      newImageUrl,
      filename,
      retryCount: 0,
    });
  }

  /**
   * Process a single task from the queue
   *
   * @param {AssetReplacementTask} task - The task to process
   */
  private async processTask(task: AssetReplacementTask): Promise<void> {
    try {
      await replaceAssetFromUrl(
        task.assetId,
        task.newImageUrl,
        this.config.apiToken,
        this.config.environment,
        this.config.baseUrl,
        task.filename,
        task.retryCount,
        this.config.initialRetryDelay,
        this.config.maxRetryDelay,
        this.config.retryBackoffFactor,
      );
      this.completedCount++;
    } catch (error) {
      console.error(
        `Failed to replace asset ${task.assetId} after multiple retries:`,
        error,
      );
      this.failedCount++;
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  /**
   * Process the queue of asset replacement tasks
   */
  private processQueue(): void {
    // Check if we need to resolve the completion promise
    if (
      this.queue.length === 0 &&
      this.activeCount === 0 &&
      this.resolvePromise
    ) {
      this.resolvePromise({
        succeeded: this.completedCount,
        failed: this.failedCount,
      });
      this.resolvePromise = null;
      this.processing = false;
      return;
    }

    // Start processing tasks up to the concurrency limit
    while (
      this.queue.length > 0 &&
      this.activeCount < (this.config.concurrency || 3)
    ) {
      const task = this.queue.shift();
      if (task) {
        this.activeCount++;
        this.processTask(task);
      }
    }
  }

  /**
   * Start processing the queue and return a promise that resolves when all tasks are complete
   *
   * @returns {Promise<{succeeded: number, failed: number}>} Results of the operation
   */
  start(): Promise<{ succeeded: number; failed: number }> {
    if (this.processing) {
      return Promise.reject(new Error('Asset replacer is already processing'));
    }

    this.processing = true;
    this.completedCount = 0;
    this.failedCount = 0;

    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.processQueue();
    });
  }

  /**
   * Get the current status of the processing
   *
   * @returns {{queued: number, active: number, completed: number, failed: number}} Status counts
   */
  getStatus(): {
    queued: number;
    active: number;
    completed: number;
    failed: number;
  } {
    return {
      queued: this.queue.length,
      active: this.activeCount,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }
}

// Export types separately to avoid 'isolatedModules' errors
export type { AssetReplacementTask, AssetReplacerConfig };

// Export the functions and classes
export { AssetReplacer };
export default replaceAssetFromUrl;
