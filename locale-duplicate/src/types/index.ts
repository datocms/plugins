import type { SimpleSchemaTypes } from '@datocms/cma-client-browser';
import type { 
  RenderFieldExtensionCtx,
  RenderConfigScreenCtx,
  RenderItemFormSidebarCtx
} from 'datocms-plugin-sdk';

// Re-export commonly used DatoCMS types
export type Item = SimpleSchemaTypes.Item;
export type ItemType = SimpleSchemaTypes.ItemType;
export type Field = SimpleSchemaTypes.Field;
export type Upload = SimpleSchemaTypes.Upload;
export type User = SimpleSchemaTypes.User;
export type Site = SimpleSchemaTypes.Site;
export type Plugin = SimpleSchemaTypes.Plugin;

// Plugin-specific types
// Used in SettingsAreaSidebar for mass duplication
export interface FieldConfig {
  modelId: string;
  modelName: string;
  fieldIds: string[];
}

// Used in ConfigScreen and main.tsx for field-level copying
export interface FieldCopyConfig {
  modelId: string;
  modelLabel: string;
  fieldId: string;
  fieldLabel: string;
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface FieldOption {
  value: string;
  label: string;
  type?: string; // Optional as it's not always present
}

// Plugin parameter types
export interface PluginParameters {
  fieldConfigs?: FieldConfig[];
}

// Locale-related types
export type LocalizedField = Record<string, unknown>;

export interface DuplicationProgress {
  current: number;
  total: number;
  currentModel?: string;
  errors: string[];
}

export interface DuplicationSummary {
  totalRecordsProcessed: number;
  successfulRecords: number;
  failedRecords: number;
  errors: string[];
}

// Type guards
export function isLocalizedField(value: unknown): value is LocalizedField {
  return (
    typeof value === 'object' && 
    value !== null && 
    !Array.isArray(value)
  );
}

export function isFieldConfig(value: unknown): value is FieldConfig {
  if (typeof value !== 'object' || value === null) return false;
  
  const obj = value as Record<string, unknown>;
  return (
    'modelId' in obj && typeof obj.modelId === 'string' &&
    'modelName' in obj && typeof obj.modelName === 'string' &&
    'fieldIds' in obj && Array.isArray(obj.fieldIds) &&
    obj.fieldIds.every((id: unknown) => typeof id === 'string')
  );
}

export function isFieldConfigArray(value: unknown): value is FieldConfig[] {
  return Array.isArray(value) && value.every(isFieldConfig);
}

export function isFieldCopyConfig(value: unknown): value is FieldCopyConfig {
  if (typeof value !== 'object' || value === null) return false;
  
  const obj = value as Record<string, unknown>;
  return (
    'modelId' in obj && typeof obj.modelId === 'string' &&
    'modelLabel' in obj && typeof obj.modelLabel === 'string' &&
    'fieldId' in obj && typeof obj.fieldId === 'string' &&
    'fieldLabel' in obj && typeof obj.fieldLabel === 'string'
  );
}

export function isFieldCopyConfigArray(value: unknown): value is FieldCopyConfig[] {
  return Array.isArray(value) && value.every(isFieldCopyConfig);
}

// Error handling utilities
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

// API response types
export interface FetchRecordsResponse {
  data: Item[];
  meta: {
    total_count: number;
  };
}

// Field type constants
export const SUPPORTED_FIELD_TYPES = [
  'string',
  'text', 
  'structured_text',
  'json',
  'seo',
  'slug'
] as const;

export type SupportedFieldType = typeof SUPPORTED_FIELD_TYPES[number];

export function isSupportedFieldType(type: string): type is SupportedFieldType {
  return (SUPPORTED_FIELD_TYPES as readonly string[]).includes(type);
}

// Context type aliases for convenience
export type ConfigScreenContext = RenderConfigScreenCtx;
export type FieldExtensionContext = RenderFieldExtensionCtx;
export type SettingsSidebarContext = RenderItemFormSidebarCtx;

// Constants
export const BATCH_SIZE = 100;
export const API_RATE_LIMIT_DELAY = 100; // milliseconds