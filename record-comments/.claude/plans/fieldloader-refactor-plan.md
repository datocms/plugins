# Fieldloader Refactor Plan

## Phase 2.1: Refactor fieldLoader.ts to Reduce Code Duplication

### Executive Summary

The `fieldLoader.ts` file contains significant code duplication (~60%), primarily in block field processing logic. This plan outlines a systematic approach to reduce duplication through abstractions while maintaining backward compatibility.

**Expected Results:**
- Current lines: ~757
- After refactor: ~450-500 lines
- Reduction: ~35-40%

---

## 1. Current Code Structure

### File Overview
- **Location:** `src/entrypoints/utils/fieldLoader.ts`
- **Total Lines:** 757 lines
- **Exports:** 5 functions
- **Internal Functions:** 5 functions

### Function Breakdown

| Function | Lines | Purpose |
|----------|-------|---------|
| `getAllowedBlockModelIds` | 55-76 | Extracts block model IDs from validators |
| `getAvailableLocales` | 83-105 | Gets locales with values for localized fields |
| `loadAllFields` | 111-172 | Entry point, loads all fields recursively |
| `loadNestedFields` | 177-339 | Loads nested fields from formValues |
| `loadNestedFieldsFromBlock` | 344-502 | Loads nested fields from block attributes |
| `getFieldValueByPath` | 508-548 | Navigates path in formValues with prefix |
| `getBlocksForField` | 557-614 | Gets block info for a field at path |
| `getFieldsForBlock` | 619-662 | Gets fields for a specific block |
| `getValueAtPath` | 669-697 | Navigates path in formValues (no prefix) |
| `getBlockAttributesAtPath` | 702-757 | Gets block attributes at specific path/index |

---

## 2. Identified Code Duplication

### Pattern 1: Block Field Processing (4 occurrences, ~120 lines duplicated)

Repeated nearly identically at:
- `loadNestedFields` - single_block case (Lines 206-256)
- `loadNestedFields` - modular_content/structured_text case (Lines 283-333)
- `loadNestedFieldsFromBlock` - single_block case (Lines 372-422)
- `loadNestedFieldsFromBlock` - modular_content/structured_text case (Lines 446-496)

**Duplicated pattern (~30 lines each):**
```typescript
for (const blockField of blockFields) {
  const blockFieldApiKey = blockField.attributes.api_key;
  const blockFieldLabel = blockField.attributes.label;
  const blockFieldLocalized = blockField.attributes.localized;
  const blockFieldType = blockField.attributes.field_type;
  const blockFieldEditorType = (blockField.attributes.appearance as...)?.editor;
  const fieldPath = `${basePath}.${blockFieldApiKey}`;
  const displayLabel = `${parentFieldLabel} > ${blockModelName} > ${blockFieldLabel}`;

  const nestedFieldValue = blockAttrs[blockFieldApiKey];
  const availableLocales = blockFieldLocalized
    ? getAvailableLocales(nestedFieldValue, allLocales)
    : undefined;

  const nestedIsBlockContainer = BLOCK_CONTAINER_TYPES.includes(blockFieldType);
  // ... push to nestedFields, recursive call
}
```

### Pattern 2: Path Navigation Logic (2 occurrences, ~40 lines duplicated)

- `getFieldValueByPath` (Lines 508-548)
- `getValueAtPath` (Lines 669-697)

Both navigate through nested object paths, handling arrays, objects, and block structures.

### Pattern 3: Locale-Specific Value Extraction (2 occurrences)

- `getBlocksForField` (Lines 569-574)
- `getBlockAttributesAtPath` (Lines 714-720)

```typescript
if (locale && fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
  const localizedValue = fieldValue as Record<string, unknown>;
  if (locale in localizedValue) {
    fieldValue = localizedValue[locale] as FieldValue;
  }
}
```

### Pattern 4: loadNestedFields vs loadNestedFieldsFromBlock (~90% identical)

These two functions differ only in how they access values:
- `loadNestedFields`: `getFieldValueByPath(formValues, parentFieldApiKey, pathPrefix)`
- `loadNestedFieldsFromBlock`: `blockAttributes[parentFieldApiKey]`

---

## 3. Proposed Abstractions

### Abstraction 1: Data Accessor Pattern

```typescript
/**
 * Interface for accessing field values from different data sources.
 */
interface FieldValueAccessor {
  getFieldValue(fieldApiKey: string): FieldValue | undefined;
}

function createFormValuesAccessor(
  formValues: Record<string, FieldValue>,
  pathPrefix: string
): FieldValueAccessor {
  return {
    getFieldValue: (apiKey) => getFieldValueByPath(formValues, apiKey, pathPrefix),
  };
}

function createBlockAttributesAccessor(
  blockAttributes: Record<string, FieldValue>
): FieldValueAccessor {
  return {
    getFieldValue: (apiKey) => blockAttributes[apiKey],
  };
}
```

### Abstraction 2: Block Field Processor

```typescript
interface BlockFieldProcessingConfig {
  ctx: RenderItemFormSidebarCtx;
  blockFields: Field[];
  blockAttrs: Record<string, FieldValue>;
  blockModelName: string;
  parentFieldLabel: string;
  basePath: string;
  depth: number;
  allLocales: string[];
  blockIndex?: number;
}

async function processBlockFields(
  config: BlockFieldProcessingConfig,
  accessor: FieldValueAccessor
): Promise<FieldInfo[]>;
```

### Abstraction 3: Unified Path Navigator

```typescript
interface PathNavigationOptions {
  checkBlockAttributes?: boolean;
}

function navigateToPath(
  root: Record<string, FieldValue>,
  path: string,
  options?: PathNavigationOptions
): FieldValue | undefined;
```

### Abstraction 4: Locale Value Extractor

```typescript
function extractLocalizedValue(
  fieldValue: FieldValue,
  locale: string | undefined
): FieldValue;
```

---

## 4. Step-by-Step Refactoring Approach

### Step 1: Create Helper Functions (Non-Breaking)

Add new functions without modifying existing code:

1. Add `extractLocalizedValue()` function
2. Add `navigateToPath()` function
3. Add `createFieldInfo()` helper

**Risk:** None - purely additive changes

### Step 2: Implement Data Accessor Pattern

1. Define `FieldValueAccessor` interface
2. Implement `createFormValuesAccessor()`
3. Implement `createBlockAttributesAccessor()`

**Risk:** Low - new code, no existing changes yet

### Step 3: Extract Block Field Processing

1. Create `processBlockFields()` function
2. Create `processSingleBlock()` for single_block handling
3. Create `processBlockArray()` for modular_content/structured_text

**Risk:** Medium - core logic extraction

### Step 4: Create Unified loadNestedFields

1. Create `loadNestedFieldsUnified()` using accessor pattern
2. Keep existing functions as thin wrappers initially

**Risk:** Medium - behavioral change risk

### Step 5: Consolidate Path Navigation

1. Replace `getFieldValueByPath()` implementation with `navigateToPath()`
2. Replace `getValueAtPath()` implementation with `navigateToPath()`
3. Keep public functions as facades

**Risk:** Low - internal implementation change only

### Step 6: Update Existing Functions

1. Update `loadNestedFields()` to use unified implementation
2. Update `loadNestedFieldsFromBlock()` to use unified implementation
3. Update `getBlocksForField()` to use `extractLocalizedValue()`
4. Update `getBlockAttributesAtPath()` to use `extractLocalizedValue()`

**Risk:** Medium - all consumers affected

---

## 5. Before/After Code Examples

### Example 1: Block Field Processing

**BEFORE (repeated 4 times, ~30 lines each):**
```typescript
for (const blockField of blockFields) {
  const blockFieldApiKey = blockField.attributes.api_key;
  const blockFieldLabel = blockField.attributes.label;
  // ... 25 more lines of setup and push logic

  if (nestedIsBlockContainer) {
    const deeperFields = await loadNestedFieldsFromBlock(/* 9 params */);
    nestedFields.push(...deeperFields);
  }
}
```

**AFTER (single call):**
```typescript
const processedFields = await processBlockFields({
  ctx,
  blockFields,
  blockAttrs,
  blockModelName,
  parentFieldLabel,
  basePath,
  depth,
  allLocales,
  blockIndex,
}, accessor);
nestedFields.push(...processedFields);
```

### Example 2: Data Accessor Pattern

**BEFORE (loadNestedFields):**
```typescript
const fieldValue = getFieldValueByPath(formValues, parentFieldApiKey, pathPrefix);
```

**BEFORE (loadNestedFieldsFromBlock):**
```typescript
const fieldValue = blockAttributes[parentFieldApiKey];
```

**AFTER (unified):**
```typescript
const accessor = createFormValuesAccessor(formValues, pathPrefix);
// OR
const accessor = createBlockAttributesAccessor(blockAttributes);

const fieldValue = accessor.getFieldValue(parentFieldApiKey);
```

### Example 3: Path Navigation

**BEFORE (two similar implementations):**
```typescript
// getFieldValueByPath - 40 lines
function getFieldValueByPath(formValues, fieldApiKey, pathPrefix) {
  if (!pathPrefix) return formValues[fieldApiKey];
  const pathParts = pathPrefix.split('.');
  // ... 20+ lines of navigation
}

// getValueAtPath - 28 lines
function getValueAtPath(formValues, path) {
  if (!path) return formValues;
  const pathParts = path.split('.');
  // ... nearly identical navigation
}
```

**AFTER (single implementation with facades):**
```typescript
function navigateToPath(root, path, options = {}) {
  if (!path) return root;
  const pathParts = path.split('.');
  let current = root;

  for (const part of pathParts) {
    if (current === undefined) return undefined;
    // ... unified navigation logic
  }
  return current;
}

// Facades for backward compatibility
function getFieldValueByPath(formValues, fieldApiKey, pathPrefix) {
  const fullPath = pathPrefix ? `${pathPrefix}.${fieldApiKey}` : fieldApiKey;
  return navigateToPath(formValues, fullPath, { checkBlockAttributes: true });
}

function getValueAtPath(formValues, path) {
  return navigateToPath(formValues, path, { checkBlockAttributes: true });
}
```

---

## 6. Testing Considerations

### Unit Testing Strategy

1. **Test fixtures** for data structures:
   - Simple flat form values
   - Nested modular content (2-3 levels)
   - Structured text with block nodes
   - Single block fields
   - Localized vs non-localized fields

2. **Snapshot tests** for `loadAllFields()`:
   - Capture current output for known model structures
   - Compare after refactoring

3. **Test each helper in isolation:**
   - `navigateToPath()` with various path formats
   - `extractLocalizedValue()` with localized/non-localized values
   - Accessor implementations

### Manual Testing Checklist

- [ ] Field mention dropdown shows all fields correctly
- [ ] Nested field paths work in mentions
- [ ] Block drill-down navigation works
- [ ] Locale selection works for localized fields
- [ ] Field navigation in sidebar works correctly
- [ ] All five mention types still function

### Regression Testing Scenarios

1. Create comment mentioning a top-level field
2. Create comment mentioning nested field in modular content
3. Create comment mentioning field in structured text block
4. Use field drill-down UI to navigate into modular content
5. Select locale for localized field mention

---

## 7. Risk Assessment

### High Risk Areas

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking recursive field loading | Field mentions broken | Medium | Snapshot tests before refactoring |
| Path navigation regression | Cannot access nested values | Medium | Unit tests for every path format |
| Block index calculation error | Wrong field paths stored | Medium | Test with structured text |

### Medium Risk Areas

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Performance regression | Slower field loading | Low | Benchmark before/after |
| Type safety loss | Runtime errors | Low | Strict TypeScript |
| Breaking public API | Consumer code breaks | Very Low | Keep exports as facades |

### Mitigation Strategies

1. **Incremental Refactoring:**
   - Implement new functions alongside existing ones
   - Switch over one call site at a time
   - Keep old implementations as fallbacks initially

2. **Comprehensive Logging:**
   - Add debug logging during transition
   - Compare outputs between old and new implementations

3. **Rollback Plan:**
   - Refactoring in isolated commits
   - Each step can be reverted independently

---

## 8. New TypeScript Signatures

### Types

```typescript
interface FieldValueAccessor {
  getFieldValue(fieldApiKey: string): FieldValue | undefined;
}

interface BlockProcessingContext {
  ctx: RenderItemFormSidebarCtx;
  allLocales: string[];
  depth: number;
}

interface BlockFieldsConfig {
  blockFields: Field[];
  blockAttrs: Record<string, FieldValue>;
  blockModelName: string;
  parentFieldLabel: string;
  basePath: string;
  blockIndex?: number;
}
```

### New Functions

```typescript
function createFieldInfo(
  field: BlockFieldMetadata,
  config: { basePath, blockModelName, parentFieldLabel, blockIndex?, depth, allLocales, fieldValue }
): FieldInfo;

async function processSingleBlock(
  ctx: RenderItemFormSidebarCtx,
  blockValue: BlockValue,
  config: { allowedBlockModelIds, basePath, parentFieldLabel, depth, allLocales, accessor }
): Promise<FieldInfo[]>;

async function processBlockArray(
  ctx: RenderItemFormSidebarCtx,
  blocks: BlockValue[],
  config: { parentFieldApiKey, parentFieldLabel, basePath, depth, allLocales, accessor }
): Promise<FieldInfo[]>;

async function loadNestedFieldsUnified(
  ctx: RenderItemFormSidebarCtx,
  accessor: FieldValueAccessor,
  config: { parentFieldApiKey, parentFieldLabel, parentFieldType, allowedBlockModelIds, allLocales, depth, basePath }
): Promise<FieldInfo[]>;
```

---

## 9. Estimated Results

### Code Reduction
- Current duplicated code: ~240 lines
- Overlapping logic: ~40 lines
- New abstractions add: ~80-100 lines
- Net reduction: ~200-250 lines (~35-40%)

### Complexity Improvements
- Reduced cyclomatic complexity
- Single Responsibility principle followed
- DRY principle followed
- Easier to unit test

---

## 10. Critical Files

| File | Role |
|------|------|
| `src/entrypoints/utils/fieldLoader.ts` | Primary refactoring target |
| `src/entrypoints/utils/blockHelpers.ts` | Contains type definitions used by fieldLoader |
| `src/entrypoints/hooks/useFieldNavigation.ts` | Primary consumer, uses getBlocksForField, getFieldsForBlock |
| `src/entrypoints/hooks/useProjectData.ts` | Consumer of loadAllFields |
| `src/entrypoints/types/mentions.ts` | Type definitions for FieldInfo |
