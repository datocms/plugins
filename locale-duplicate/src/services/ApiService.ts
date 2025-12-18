/**
 * API Service for centralized DatoCMS API operations
 */

import { buildClient, Client } from '@datocms/cma-client-browser';
import type { Item, ItemType, Field } from '../types';

export interface PaginationOptions {
  page?: number;
  perPage?: number;
  version?: 'published' | 'current';
}

/**
 * Service class for handling DatoCMS API operations
 */
export class ApiService {
  private client: Client;
  
  constructor(apiToken: string, environment?: string) {
    this.client = buildClient({
      apiToken,
      environment,
    });
  }
  
  /**
   * Fetch all models (item types)
   */
  async fetchModels(excludeModularBlocks = true): Promise<ItemType[]> {
    console.log('[ApiService] Fetching models...');
    const models = await this.client.itemTypes.list();
    
    return excludeModularBlocks 
      ? models.filter(model => !model.modular_block)
      : models;
  }
  
  /**
   * Fetch fields for a specific model
   */
  async fetchFields(modelId: string): Promise<Field[]> {
    console.log(`[ApiService] Fetching fields for model ${modelId}...`);
    return await this.client.fields.list(modelId);
  }
  
  /**
   * Fetch records with pagination support
   */
  async fetchRecords(
    modelId: string,
    options: PaginationOptions = {}
  ): Promise<{ data: Item[]; totalCount: number }> {
    const { page = 1, perPage = 500, version = 'current' } = options;
    console.log(`[ApiService] Fetching records for model ${modelId}, page ${page}...`);
    
    // Get model API key first
    const models = await this.fetchModels();
    const model = models.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Model with ID ${modelId} not found`);
    }
    
    const allRecords: Item[] = [];
    let totalCount = 0;
    
    // If requesting all records (perPage is high), use iterator
    if (perPage >= 500) {
      for await (const record of this.client.items.listPagedIterator({
        filter: { type: model.api_key },
        nested: true,
        version
      })) {
        allRecords.push(record);
        totalCount++;
      }
    } else {
      // Otherwise use pagination
      const response = await this.client.items.list({
        filter: { type: model.api_key },
        page: { offset: (page - 1) * perPage, limit: perPage },
        nested: true,
        version
      });
      
      allRecords.push(...response);
      totalCount = response.length;
    }
    
    return { data: allRecords, totalCount };
  }
  
  /**
   * Update a single record
   */
  async updateRecord(recordId: string, updates: Record<string, any>): Promise<Item> {
    console.log(`[ApiService] Updating record ${recordId}...`);
    return await this.client.items.update(recordId, updates);
  }
  
  /**
   * Publish multiple records
   */
  async publishRecords(records: Array<{ type: 'item'; id: string }>): Promise<void> {
    console.log(`[ApiService] Publishing ${records.length} records...`);
    
    // Publish in batches to avoid API limits
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await this.client.items.bulkPublish({ items: batch });
    }
  }
}