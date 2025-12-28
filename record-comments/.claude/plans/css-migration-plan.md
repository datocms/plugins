# CSS Migration Plan: Tokens and Utilities Integration

## Executive Summary

This plan details the migration of 4 CSS module files to use the new `tokens.css` and `utilities.css` system. The migration will:
- Replace ~180+ hardcoded color values with semantic tokens
- Replace ~120+ hardcoded spacing values with spacing tokens
- Consolidate ~25 duplicated patterns via CSS `composes`
- Remove an estimated 400-500 lines of CSS through consolidation

---

## Summary Statistics

| File | Current Lines | Estimated Lines After | Lines Saved | % Reduction |
|------|---------------|----------------------|-------------|-------------|
| comment.module.css | 1365 | ~1205-1225 | 140-160 | ~11% |
| dashboard.module.css | 1394 | ~1244-1264 | 130-150 | ~10% |
| commentbar.module.css | 364 | ~319-329 | 35-45 | ~11% |
| richcomposer.module.css | 89 | ~79-84 | 5-10 | ~8% |
| **Total** | **3212** | **~2847-2902** | **~310-365** | **~10-11%** |

---

## File 1: comment.module.css (1365 lines)

### Summary of Changes
The largest file with extensive tooltip, mention, and action button styling. High duplication with utilities.css patterns.

### Hardcoded Colors to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 18 | `#f5f5f5` | `var(--bg-secondary)` |
| 162-163 | `#1d1c1d`, `#fff` | `var(--tooltip-bg)`, `var(--tooltip-text)` |
| 173 | `rgba(0, 0, 0, 0.15)` | `var(--shadow-medium)` |
| 302-304 | `#e8e8e8`, `#d0d0d0` | `var(--action-bg-hover)`, `var(--border-strong)` |
| 325 | `#666` | `var(--text-secondary)` |
| 377-378 | `#e01e5a`, `rgba(224, 30, 90, 0.1)` | `var(--color-danger)`, `var(--color-danger-bg)` |
| 587-598 | field mention colors | `var(--mention-field-*)` tokens |
| 716-728 | model mention colors | `var(--mention-model-*)` tokens |
| 749-760 | user mention colors | `var(--mention-user-*)` tokens |
| 826-838 | asset mention colors | `var(--mention-asset-*)` tokens |
| 982-1000 | record mention colors | `var(--mention-record-*)` tokens |

### Hardcoded Spacing to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 161 | `padding: 6px 10px` | `padding: var(--space-1) var(--space-2)` |
| 473-480 | `padding: 8px 12px` | `padding: var(--space-1) var(--space-2)` |
| 527 | `padding: 8px 12px` | `padding: var(--space-1) var(--space-2)` |
| 567-568 | `padding: 16px 12px` | `padding: var(--space-3) var(--space-2)` |

### Border Radius to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 13, 34, 94 | `4px` | `var(--radius-md)` |
| 167, 204, 304, 455 | `6px` | `var(--radius-lg)` |
| 917 | `8px` | `var(--radius-xl)` |

### Transitions to Replace
All `0.15s ease` or `0.1s ease` occurrences -> `var(--transition-fast)`

Lines: 14, 98, 131, 170, 206, 258, 592, 755, 832, 923, 987, 1101

### Styles That Can Use `composes`

1. **Tooltip patterns** (6 instances, ~15 lines each = ~60 lines saved):
```css
.tooltip {
  composes: tooltipBase from './utilities.css';
  /* only unique positioning */
}
.tooltipArrow {
  composes: tooltipArrowTop from './utilities.css';
}
```

2. **Mention inline styles** (5 types, ~20 lines each = ~80 lines saved):
```css
.fieldMention {
  composes: mentionField from './utilities.css';
}
.userMention {
  composes: mentionUser from './utilities.css';
}
```

3. **Dropdown container**:
```css
.mentionDropdown {
  composes: dropdownBase from './utilities.css';
}
```

4. **Avatar styles**:
```css
.mentionUserAvatar {
  composes: avatarMd from './utilities.css';
}
```

### Before/After Example: Tooltip

```css
/* BEFORE (lines 156-174) */
.tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  background-color: #1d1c1d;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  border-radius: 6px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease, visibility 0.15s ease;
  pointer-events: none;
  z-index: 9999;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* AFTER */
.tooltip {
  composes: tooltipBase from './utilities.css';
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--transition-fast), visibility var(--transition-fast);
}
```

---

## File 2: dashboard.module.css (1394 lines)

### Summary of Changes
The second largest file with extensive filter UI, search, and layout styles. High opportunity for token usage.

### Hardcoded Colors to Replace

| Pattern | Current Value | Token Replacement |
|---------|---------------|-------------------|
| Background white | `#fff` | `var(--bg-primary)` |
| Background light | `#fafafa` | `var(--bg-tertiary)` |
| Background secondary | `#f5f5f5` | `var(--bg-secondary)` |
| Border light | `#f0f0f0` | `var(--border-light)` |
| Border default | `#e0e0e0` | `var(--border-default)` |
| Text primary | `#34363a` | `var(--text-primary)` |
| Text secondary | `#848484` | `var(--text-secondary)` |
| Tooltip bg | `#1d1c1d` | `var(--tooltip-bg)` |
| Action bg | `#e8e8e8` | `var(--action-bg-hover)` |

### Spacing Patterns to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 69 | `padding: 16px 24px` | `padding: var(--space-3) var(--space-4)` |
| 98 | `padding: 12px 24px` | `padding: var(--space-2) var(--space-4)` |
| 128 | `padding: 48px 24px` | `padding: var(--space-8) var(--space-4)` |
| 163-164 | `gap: 6px`, `padding: 8px 16px` | `gap: var(--space-1)`, tokens |
| 193-194 | `padding: 16px 24px` | `padding: var(--space-3) var(--space-4)` |

### Styles That Can Use `composes`

1. **Loading state**:
```css
.loading {
  composes: flexCenter from './utilities.css';
  padding: var(--space-5);
  color: var(--text-secondary);
}
```

2. **Empty states**:
```css
.empty {
  composes: textSecondary from './utilities.css';
  padding: var(--space-5) var(--space-3);
  text-align: center;
}
```

3. **Filter dropdown**:
```css
.filterDropdownMenu {
  composes: dropdownBase from './utilities.css';
}
```

4. **Button patterns**:
```css
.clearAllButton, .moreFiltersButton, .loadEarlierButton {
  composes: buttonBase from './utilities.css';
}
```

---

## File 3: commentbar.module.css (364 lines)

### Summary of Changes
Sidebar layout and composer styles. Moderate duplication with utilities.

### Hardcoded Colors to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 58-60 | warning colors | warning tokens (to be added) |
| 233-234 | `#7c3aed`, `#f3e8ff` | `var(--mention-user)`, `var(--mention-user-bg)` |
| 237-239 | `#1264a3`, `#e8f5fa` | `var(--mention-field)`, `var(--mention-field-bg)` |
| 241-243 | `#059669`, `#ecfdf5` | `var(--mention-record)`, `var(--mention-record-bg)` |
| 245-247 | `#0891b2`, `#ecfeff` | `var(--mention-asset)`, `var(--mention-asset-bg)` |
| 249-251 | `#d97706`, `#fffbeb` | `var(--mention-model)`, `var(--mention-model-bg)` |

### Styles That Can Use `composes`

1. **Composer avatar**:
```css
.composerAvatar {
  composes: avatarLg from './utilities.css';
}
```

2. **Toolbar button**:
```css
.toolbarButton {
  composes: buttonBase from './utilities.css';
}
```

3. **Send button**:
```css
.sendButton {
  composes: buttonBase from './utilities.css';
}
```

---

## File 4: richcomposer.module.css (89 lines)

### Summary of Changes
The smallest file, focused on contentEditable composer styling. Limited but impactful token usage.

### Spacing to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 7 | `padding: 10px 12px` | `padding: var(--space-2)` |
| 23 | `min-height: 24px` | `min-height: var(--space-4)` |
| 43-44 | `top: 10px`, `left: 12px` | `top: var(--space-2)`, `left: var(--space-2)` |

### Border Radius to Replace

| Line(s) | Current Value | Token Replacement |
|---------|---------------|-------------------|
| 14 | `8px 8px 0 0` | `var(--radius-xl) var(--radius-xl) 0 0` |

---

## Additional Tokens to Add

Add these to `tokens.css` before migration:

```css
/* Warning state colors */
--color-warning: #92400e;
--color-warning-bg: #fef3c7;
--color-warning-border: #fcd34d;

/* Error state colors */
--color-error: #c00;
--color-error-bg: #fff0f0;
--color-error-border: #ffc0c0;

/* Block mention colors */
--mention-block: #6366f1;
--mention-block-bg: rgba(99, 102, 241, 0.1);

/* Focus ring shadow */
--shadow-focus: 0 0 0 2px rgba(18, 100, 163, 0.15);

/* Sidebar shadow */
--shadow-sidebar: -4px 0 12px rgba(0, 0, 0, 0.08);
```

---

## Implementation Sequence

### Phase 5.1: Add missing tokens to tokens.css
Add warning, error, block mention, and shadow tokens

### Phase 5.2: Migrate comment.module.css
1. Start with tooltip consolidation (6 instances)
2. Then mention type colors
3. Finally spacing and radius

### Phase 5.3: Migrate dashboard.module.css
1. Focus on repeated color patterns first
2. Then filter UI consolidation

### Phase 5.4: Migrate commentbar.module.css
1. Toolbar button colors
2. Composer styles

### Phase 5.5: Migrate richcomposer.module.css
Quick wins with spacing tokens

### Phase 5.6: Verification and cleanup
1. Visual regression check
2. Remove unused CSS
3. Update documentation

---

## Potential Breaking Changes and Risks

### Low Risk
- Color value slight differences when consolidated
- Spacing rounding (6px grid doesn't match all existing values)

### Medium Risk
- CSS variable browser support (all modern browsers OK)
- `composes` directive compatibility with Vite
- Specificity changes from `composes`

### Mitigation Strategies
1. Visual regression testing (screenshot comparison)
2. Incremental migration (one file at a time)
3. Fallback values: `color: var(--token, #fallback)`

---

## Critical Files

- `src/entrypoints/styles/comment.module.css` - Primary target
- `src/entrypoints/styles/dashboard.module.css` - Second target
- `src/entrypoints/styles/tokens.css` - Token definitions
- `src/entrypoints/styles/utilities.css` - Utility classes
- `src/entrypoints/styles/commentbar.module.css` - Third target
- `src/entrypoints/styles/richcomposer.module.css` - Final target
