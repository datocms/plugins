/**
 * DatoCMS Asset Replacement Utility
 * 
 * This module provides functions to replace existing assets in DatoCMS
 * with new optimized versions from a URL, with support for parallel processing
 * and rate limiting.
 * 
 * @module assetReplacer
 */

/**
 * Interface for the upload request response from DatoCMS
 */
interface UploadRequestResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      url: string;
      request_headers: Record<string, string>;
    };
  };
}

/**
 * Interface for the asset update response from DatoCMS
 */
interface AssetUpdateResponse {
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
  };
}

/**
 * Interface for the job result response from DatoCMS
 */
interface JobResultResponse {
  data: {
    type: string;
    id: string;
    attributes?: {
      status: number;
      payload: {
        data: {
          type: string;
          id: string;
          attributes: Record<string, unknown>;
        };
      };
    };
  };
}

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
  concurrency?: number; // Number of concurrent replacements
  initialRetryDelay?: number; // Initial retry delay in ms
  maxRetryDelay?: number; // Maximum retry delay in ms
  retryBackoffFactor?: number; // Multiplier for each retry
}

/**
 * Waits for a job to complete by polling the job result endpoint.
 * 
 * @param {string} jobId - The ID of the job to check
 * @param {string} apiToken - DatoCMS API token
 * @param {string} environment - Environment for the DatoCMS API call
 * @param {number} [maxAttempts=60] - Maximum number of polling attempts
 * @param {number} [interval=2000] - Polling interval in milliseconds
 * @returns {Promise<JobResultResponse>} The final job result
 * @throws {Error} If the job fails or times out
 */
async function waitForJobCompletion(
  jobId: string,
  apiToken: string,
  environment: string,
  maxAttempts = 60,
  interval = 2000
): Promise<JobResultResponse> {
  const baseUrl = 'https://site-api.datocms.com';
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-Version': '3',  
    'X-Environment': environment
  };
  
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    try {
      console.log(`Checking job status (attempt ${attempts}/${maxAttempts}): ${jobId}`);
      
      const response = await fetch(`${baseUrl}/job-results/${jobId}`, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${errorText}`);
      }
      
      const jobResult = await response.json() as JobResultResponse;
      
      // Check if the job has completed
      if (jobResult.data.attributes && jobResult.data.attributes.status === 200) {
        console.log(`Job completed successfully: ${jobId}`);
        return jobResult;
      }
      
      // If we get here, the job is still processing
      console.log(`Job in progress (${attempts}/${maxAttempts}), waiting ${interval}ms...`);
      await new Promise(resolve => setTimeout(resolve, interval));
      
    } catch (error) {
      console.error(`Error checking job status: ${error instanceof Error ? error.message : String(error)}`);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  throw new Error(`Job timed out after ${maxAttempts} attempts: ${jobId}`);
}

/**
 * Sleep for a specified duration
 * 
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

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
  backoffFactor: number
): number => {
  const delay = initialDelay * (backoffFactor ** retryCount);
  return Math.min(delay, maxDelay);
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
  filename?: string,
  retryCount = 0,
  initialRetryDelay = 1000,
  maxRetryDelay = 60000,
  retryBackoffFactor = 2
): Promise<AssetUpdateResponse> {
  console.log(`Replacing DatoCMS asset ID ${assetId} with image from URL: ${newImageUrl}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
  
  if (!assetId || !apiToken) {
    throw new Error('Missing required parameters: assetId and apiToken are required');
  }
  
  try {
    const baseUrl = 'https://site-api.datocms.com';
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Version': '3',  
      'X-Environment': environment
    };

    // Step 1: Create an upload request to get a pre-signed S3 URL
    const uploadRequestResponse = await fetch(`${baseUrl}/upload-requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'upload_request',
          attributes: {
            filename: filename || 'optimized-image.jpg'
          }
        }
      })
    });

    // Handle rate limiting specifically
    if (uploadRequestResponse.status === 429) {
      const retryAfterHeader = uploadRequestResponse.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 0;
      
      // Use the Retry-After header if available, or calculate backoff
      const delayMs = retryAfterSeconds > 0 
        ? retryAfterSeconds * 1000 
        : calculateBackoff(retryCount, initialRetryDelay, maxRetryDelay, retryBackoffFactor);
      
      console.log(`Rate limit exceeded. Retrying after ${delayMs}ms`);
      await sleep(delayMs);
      
      // Retry with incremented retry count
      return replaceAssetFromUrl(
        assetId, 
        newImageUrl, 
        apiToken, 
        environment, 
        filename, 
        retryCount + 1,
        initialRetryDelay,
        maxRetryDelay,
        retryBackoffFactor
      );
    }

    if (!uploadRequestResponse.ok) {
      const errorText = await uploadRequestResponse.text();
      throw new Error(`Failed to create upload request: ${uploadRequestResponse.status} ${errorText}`);
    }

    const uploadRequestData: UploadRequestResponse = await uploadRequestResponse.json();
    
    const { 
      id: uploadPath, 
      attributes: { 
        url: s3Url, 
        request_headers: s3Headers 
      } 
    } = uploadRequestData.data;

    // Step 2: Fetch the image from the newImageUrl
    const imageResponse = await fetch(newImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image from URL: ${imageResponse.status} ${imageResponse.statusText}`);
    }
    
    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const imageBuffer = new Uint8Array(arrayBuffer);

    // Step 3: Upload the image to S3 using the pre-signed URL
    const s3Response = await fetch(s3Url, {
      method: 'PUT',
      headers: {
        ...s3Headers,
        'Content-Length': imageBuffer.length.toString()
      },
      body: imageBuffer
    });

    if (!s3Response.ok) {
      throw new Error(`Failed to upload file to S3: ${s3Response.status} ${s3Response.statusText}`);
    }

    // Step 4: Update the asset metadata to link it with the new file
    const updateResponse = await fetch(`${baseUrl}/uploads/${assetId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        data: {
          id: assetId,
          type: 'upload',
          attributes: {
            path: uploadPath
          }
        }
      })
    });

    // Handle rate limiting specifically for this step too
    if (updateResponse.status === 429) {
      const retryAfterHeader = updateResponse.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 0;
      
      // Use the Retry-After header if available, or calculate backoff
      const delayMs = retryAfterSeconds > 0 
        ? retryAfterSeconds * 1000 
        : calculateBackoff(retryCount, initialRetryDelay, maxRetryDelay, retryBackoffFactor);
      
      console.log(`Rate limit exceeded during asset update. Retrying after ${delayMs}ms`);
      await sleep(delayMs);
      
      // Retry with incremented retry count
      return replaceAssetFromUrl(
        assetId, 
        newImageUrl, 
        apiToken, 
        environment, 
        filename, 
        retryCount + 1,
        initialRetryDelay,
        maxRetryDelay,
        retryBackoffFactor
      );
    }

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Failed to update asset metadata: ${updateResponse.status} ${errorText}`);
    }

    // Step 5: If we received a job ID, wait for the job to complete
    const responseData = await updateResponse.json();
    
    if (responseData.data && responseData.data.type === 'job') {
      // We got a job ID instead of the completed upload, need to wait for job completion
      const jobId = responseData.data.id;
      console.log(`Asset update initiated as job ${jobId}, waiting for completion...`);
      
      // Wait for the job to complete
      const jobResult = await waitForJobCompletion(jobId, apiToken, environment);
      
      if (jobResult.data.attributes?.status !== 200) {
        throw new Error(`Job completed with error status: ${jobResult.data.attributes?.status}`);
      }
      
      // Return the upload data from the job result
      return jobResult.data.attributes.payload as AssetUpdateResponse;
    }

    console.log('Asset replaced successfully:', responseData);
    return responseData as AssetUpdateResponse;
  } catch (error) {
    // For rate limit errors, we already handle them specifically above
    // For other errors, decide whether to retry based on retry count
    if (error instanceof Error && error.message.includes('API error') && retryCount < 5) {
      const delayMs = calculateBackoff(retryCount, initialRetryDelay, maxRetryDelay, retryBackoffFactor);
      console.error(`Error replacing asset: ${error.message}. Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      
      // Retry with incremented retry count
      return replaceAssetFromUrl(
        assetId, 
        newImageUrl, 
        apiToken, 
        environment, 
        filename, 
        retryCount + 1,
        initialRetryDelay,
        maxRetryDelay,
        retryBackoffFactor
      );
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
  private resolvePromise: ((value: { succeeded: number; failed: number }) => void) | null = null;

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
      retryBackoffFactor: config.retryBackoffFactor || 2
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
      retryCount: 0
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
        task.filename,
        task.retryCount,
        this.config.initialRetryDelay,
        this.config.maxRetryDelay,
        this.config.retryBackoffFactor
      );
      this.completedCount++;
    } catch (error) {
      console.error(`Failed to replace asset ${task.assetId} after multiple retries:`, error);
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
    if (this.queue.length === 0 && this.activeCount === 0 && this.resolvePromise) {
      this.resolvePromise({ 
        succeeded: this.completedCount, 
        failed: this.failedCount 
      });
      this.resolvePromise = null;
      this.processing = false;
      return;
    }

    // Start processing tasks up to the concurrency limit
    while (this.queue.length > 0 && this.activeCount < (this.config.concurrency || 3)) {
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
  start(): Promise<{succeeded: number, failed: number}> {
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
  getStatus(): {queued: number, active: number, completed: number, failed: number} {
    return {
      queued: this.queue.length,
      active: this.activeCount,
      completed: this.completedCount,
      failed: this.failedCount
    };
  }
}

// Export types separately to avoid 'isolatedModules' errors
export type { AssetReplacerConfig, AssetReplacementTask };

// Export the functions and classes
export { AssetReplacer };
export default replaceAssetFromUrl;
