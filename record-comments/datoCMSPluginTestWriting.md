# DatoCMS Plugin Testing Guide

> **WARNING: USE A DEDICATED FREE ACCOUNT WITH NO OTHER PROJECTS**
>
> This guide instructs automated tests to **create and delete DatoCMS projects**. Running these tests on an account with real projects is **extremely dangerous** and could result in data loss. Always use a fresh, free DatoCMS account dedicated solely to testing.

---

> "Your job is to deliver code you have proven to work."

This guide establishes a testing strategy for DatoCMS plugins that provides **repeatable, automated proof** that your code works. It applies to any DatoCMS plugin (sidebar panels, field extensions, pages, etc.).

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Test Architecture](#test-architecture)
3. [Environment Setup](#environment-setup)
4. [Fresh Project Isolation](#fresh-project-isolation)
5. [Marketing Starter Template Map](#marketing-starter-template-map)
6. [Unit Tests (Vitest)](#unit-tests-vitest)
7. [E2E Tests (Playwright)](#e2e-tests-playwright)
8. [Bundle Exclusion](#bundle-exclusion)
9. [CI Integration](#ci-integration)
10. [Writing Your First Tests](#writing-your-first-tests)

---

## Philosophy

DatoCMS plugins present a unique testing challenge: they require a **real DatoCMS context** (`ctx` object) to function properly. Mocking this context is fragile and drifts from reality.

Our approach:

| Layer | Tool | What It Tests | Speed |
|-------|------|---------------|-------|
| Unit | Vitest | Pure functions, state logic, serialization | Fast (~ms) |
| E2E | Playwright | Real plugin in real DatoCMS project | Slower (~s) |

**Both layers are required.** Unit tests catch logic regressions quickly. E2E tests prove the plugin actually works in DatoCMS.

### The Workflow

```
1. Write/update test with expected behavior
2. Run test → should fail (red)
3. Implement the change
4. Run test → should pass (green)
5. Commit includes BOTH implementation + test
```

For existing plugins without tests, write comprehensive tests first, then maintain this workflow for all future changes.

---

## Test Architecture

```
your-plugin/
├── src/                          # Source code (bundled)
├── tests/                        # All test code (never bundled)
│   ├── unit/                     # Vitest unit tests
│   │   ├── helpers.test.ts
│   │   ├── serializers.test.ts
│   │   └── state.test.ts
│   ├── e2e/                      # Playwright E2E tests
│   │   ├── fixtures/             # Test utilities, page objects
│   │   │   ├── dato-project.ts   # Project creation/deletion helpers
│   │   │   ├── dato-auth.ts      # Authentication helpers
│   │   │   └── plugin-page.ts    # Plugin-specific page objects
│   │   ├── .auth/                # Saved auth state (gitignored)
│   │   ├── sidebar.spec.ts
│   │   ├── field-extension.spec.ts
│   │   └── config-screen.spec.ts
│   └── setup/                    # Global setup/teardown
│       ├── global-setup.ts       # Creates fresh project, installs plugin
│       └── global-teardown.ts    # Deletes test project
├── .env.test.local               # Real credentials (gitignored)
├── .env.test.local.example       # Template for credentials
├── vitest.config.ts              # Vitest configuration
├── playwright.config.ts          # Playwright configuration
└── package.json
```

---

## Environment Setup

### `.env.test.local.example`

Create this file as a template. Developers copy it to `.env.test.local` and fill in real values.

```bash
# =============================================================================
# DatoCMS Plugin E2E Test Configuration
# =============================================================================
# Copy this file to .env.test.local and fill in real values.
# NEVER commit .env.test.local to version control.
# =============================================================================

# -----------------------------------------------------------------------------
# Authentication
# -----------------------------------------------------------------------------
# Email and password for a DatoCMS account.
# This account will be used to create/delete test projects.
# Recommendation: Create a dedicated test account, not your personal account.
DATOCMS_TEST_EMAIL=your-test-account@example.com
DATOCMS_TEST_PASSWORD=your-secure-password

# -----------------------------------------------------------------------------
# Plugin Configuration
# -----------------------------------------------------------------------------
# Local development URL where the plugin is served (usually http://localhost:5173)
PLUGIN_DEV_URL=http://localhost:5173

# Plugin name as it will appear in DatoCMS
PLUGIN_NAME=My Plugin Name

# Plugin entry points to configure (comma-separated)
# Options: sidebar, page, field, configScreen
# Example: "sidebar,configScreen" or "field"
PLUGIN_ENTRY_POINTS=sidebar

# -----------------------------------------------------------------------------
# Plugin-Specific Settings (Optional)
# -----------------------------------------------------------------------------
# If your plugin requires configuration in its settings screen,
# add those values here. These will be entered during plugin setup.
# Example for a plugin that needs an API key:
# PLUGIN_SETTING_API_KEY=your-api-key
# PLUGIN_SETTING_WORKSPACE_ID=your-workspace-id

# -----------------------------------------------------------------------------
# Test Configuration
# -----------------------------------------------------------------------------
# Slow down tests for debugging (milliseconds between actions)
# Set to 0 for CI, higher values (e.g., 500) for watching tests run
PLAYWRIGHT_SLOW_MO=0

# Keep browser open after test failure for debugging
# Set to "true" for local debugging, "false" for CI
PLAYWRIGHT_HEADED=false

# Screenshot on failure: "on", "off", or "only-on-failure"
PLAYWRIGHT_SCREENSHOTS=only-on-failure
```

### `.gitignore` additions

```gitignore
# Test credentials (never commit)
.env.test.local

# Playwright artifacts
tests/e2e/.auth/
test-results/
playwright-report/
playwright/.cache/

# Vitest artifacts
coverage/

# Test project state (written by global setup)
tests/e2e/.test-project.json
```

---

## Fresh Project Isolation

Every E2E test run creates a **fresh DatoCMS project** from the Marketing Starter template. This guarantees:

- **Clean slate**: No pollution from previous test runs
- **Safe destructive operations**: Delete records, break things—it's disposable
- **Reproducible state**: Same starting point every time
- **No maintenance**: No long-lived "test project" to babysit

### How It Works

```
npm run test:e2e

┌─────────────────────────────────────────────────────────────┐
│ GLOBAL SETUP                                                │
├─────────────────────────────────────────────────────────────┤
│ 1. Clean up orphaned test projects (from failed runs)       │
│ 2. Login to DatoCMS                                         │
│ 3. Create project from Marketing Starter template           │
│ 4. Navigate to /configuration/plugins/new-private           │
│ 5. Install plugin from local dev URL                        │
│ 6. Configure plugin settings (if needed)                    │
│ 7. Save project URL + auth state for tests                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ TEST EXECUTION                                              │
├─────────────────────────────────────────────────────────────┤
│ All E2E tests run against the fresh project                 │
│ Tests can create, modify, delete any data                   │
│ Plugin has real ctx, real SDK, real API                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GLOBAL TEARDOWN                                             │
├─────────────────────────────────────────────────────────────┤
│ 1. Navigate to project deletion page                        │
│ 2. Confirm and delete the test project                      │
│ 3. Clean up local state files                               │
└─────────────────────────────────────────────────────────────┘
```

### Project Naming Convention

Test projects are named with a recognizable pattern:

```
e2e-test-{plugin-name}-{timestamp}
```

Example: `e2e-test-comments-plugin-1704067200000`

This allows orphan cleanup to identify and delete projects from failed test runs.

---

## Marketing Starter Template Map

The Marketing Starter template provides a rich set of models, blocks, and field types for testing. This comprehensive map helps you locate specific field types, presentations, and structures for your E2E tests.

### Quick Reference: Where to Find Each Field Type

| Field Type | Model/Block | Field API Key |
|------------|-------------|---------------|
| Single-line String | Author | `name`, `bio` |
| Single-line String (localized) | Author | `name`, `bio`, `area_of_interest` |
| Multiple-paragraph Text | Layout | `footer_subtitle` |
| Multiple-paragraph Text (localized) | Author | `description` |
| Structured Text | Blog Post | `content` |
| Structured Text (localized) | Pricing Tier | `tier_description` |
| Structured Text with inline records | Blog Post | `content` (links to Blog Post) |
| Structured Text with blocks | Blog Post | `content` (Image block, CTA blocks) |
| Single Asset (image) | Author | `picture` |
| Single Link | Blog Post | `author` → Author |
| Multiple Links | Blog Post | `tags` → Tag |
| Modular Content | Page | `sections` (15+ block types) |
| Modular Content (nested blocks) | Hero section | `buttons` → Button |
| Slug | All models | `slug` |
| Color | Layout | `main_color` |
| Integer Number | Pricing Tier | `monthly_price` |
| Floating-point Number | Pricing Tier | `yearly_price` |
| DateTime | Changelog entry | `time_of_release` |
| JSON | Page | `seo_analysis` |
| SEO and Social | Page | `seo_meta` |

---

### Models

#### 🧩 Layout (`layout`) - Singleton
Global site layout settings.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| 🎨 Theme Settings | Accent Color* | `main_color` | Color |
| 🚩 Top Notification Bar | Message to show | `notification` | Structured Text |
| ⭐ Header | Logo* | `logo` | Single Asset |
| ⭐ Header | Navigation bar | `menu` | Modular Content → Menu Dropdown, Menu Item |
| 🏁 Footer | Footer Logo | `footer_logo` | Single Asset |
| 🏁 Footer | Footer Subtitle | `footer_subtitle` | Multiple-paragraph Text |
| 🏁 Footer | Social Media Links | `social_media_links` | Modular Content → Social Media Icon |
| 🏁 Footer | Footer Links | `footer_links` | Multiple Links → Legal Page |

#### 🏡 Page (`page`)
Main page builder with modular sections.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Label* | `label` | Single-line String |
| | Sections | `sections` | Modular Content → 15 section blocks (see Blocks) |
| 📊 SEO & Readability | Slug* | `slug` | Slug |
| 📊 SEO & Readability | SEO Meta | `seo_meta` | SEO and Social |
| 📊 SEO & Readability | SEO Analysis | `seo_analysis` | JSON |

#### ✍️ Author (`author`)
Blog post authors.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Name* | `name` | Single-line String (localized) |
| | Picture* | `picture` | Single Asset |
| ℹ️ Additional info | Bio* | `bio` | Single-line String (localized) |
| ℹ️ Additional info | Description* | `description` | Multiple-paragraph Text (localized) |
| ℹ️ Additional info | Area of interest | `area_of_interest` | Single-line String (localized) |
| | Slug* | `slug` | Slug |

#### 📰 Blog Post (`post`)
Rich content with Structured Text, inline records, and blocks.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Title* | `title` | Single-line String (localized) |
| | Content* | `content` | Structured Text (localized) - **Inline Records**: Blog Post; **Blocks**: Image block, CTA Newsletter, CTA Button, CTA App Download |
| ℹ️ Additional information | Author* | `author` | Single Link → Author |
| ℹ️ Additional information | Tags | `tags` | Multiple Links → Tag |
| 📊 SEO & Readability | Slug* | `slug` | Slug |
| 📊 SEO & Readability | SEO Tags | `seo_tags` | SEO and Social (localized) |
| 📊 SEO & Readability | SEO Analysis | `seo_analysis` | JSON |

#### 🏷️ Tag (`tag`)
Blog post tags.

| Field | API Key | Type |
|-------|---------|------|
| Tag* | `tag` | Single-line String (localized) |
| Slug* | `slug` | Slug |

#### 💰 Pricing Tier (`pricing_tier`)
Pricing plans with number fields.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Tier name* | `tier_name` | Single-line String |
| | Description* | `tier_description` | Structured Text (localized) |
| | Plan Features* | `plan_features` | Single-line String |
| 💰 Pricing | Monthly price* | `monthly_price` | Integer Number |
| 💰 Pricing | Yearly price* | `yearly_price` | Floating-point Number |
| | Slug* | `slug` | Slug |

#### ⭐ Testimonial (`testimonial`)
Customer testimonials.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Rating* | `rating` | Integer Number |
| | Review* | `review` | Structured Text (localized) |
| 👤 Testimonial | Picture* | `reviewer_picture` | Single Asset |
| 👤 Testimonial | Name* | `reviewer_name` | Single-line String |
| 👤 Testimonial | Title | `reviewer_title` | Single-line String |

#### 📖 Documentation Page (`documentation_page`)
Documentation articles.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Title* | `title` | Single-line String |
| | Subtitle | `subtitle` | Single-line String |
| | Content* | `content` | Structured Text |
| 📊 SEO | Slug* | `slug` | Slug |
| 📊 SEO | SEO Meta | `seo_meta` | SEO and Social |

#### 📚 Documentation Home (`documentation_home`) - Singleton
Documentation landing page.

| Fieldset | Field | API Key | Type |
|----------|-------|---------|------|
| | Title* | `title` | Single-line String |
| | Subheader | `subheader` | Single-line String |
| | Highlighted doc pages | `featured_pages` | Multiple Links → Documentation Page |
| 📱 Sidebar | Logo* | `logo` | Single Asset |
| 📱 Sidebar | Footer text | `footer_text` | Single-line String |

#### 🧪 Changelog entry (`change_log`)
Version changelog with DateTime field.

| Field | API Key | Type |
|-------|---------|------|
| Version Name* | `version_name` | Single-line String |
| Time of release* | `time_of_release` | **DateTime** |
| Content* | `content` | Structured Text |
| Slug* | `slug` | Slug |

#### 🏛️ Legal Page (`legal_page`)
Legal/policy pages.

| Field | API Key | Type |
|-------|---------|------|
| Title* | `title` | Single-line String (localized) |
| Content* | `content` | Structured Text (localized) |
| Slug* | `slug` | Slug |

---

### Blocks Library

#### Layout & Navigation
| Block | API Key | Used In |
|-------|---------|---------|
| 🌐 Social Media Icon | `social_media_icon` | Layout → Social Media Links |
| ➡️ Menu Item | `menu_item` | Layout → Navigation bar |
| 🔽 Menu Dropdown | `menu_dropdown` | Layout → Navigation bar |

#### Page Sections (for Page → Sections field)
| Block | API Key | Notable Fields |
|-------|---------|----------------|
| 🚀 Hero section | `hero_section` | Modular Content with nested Button blocks |
| 📋 Feature list section | `feature_list_section` | |
| 🏢 Brands Section | `brands_section` | |
| 📹 Video Section | `video_section` | |
| 💬 Testimonials Section | `review_section` | |
| 💰 Pricing section | `pricing_section` | |
| 📰 Featured posts section | `featured_posts_section` | |
| 📄 Detail section | `detail_section` | |
| 👥 Team Section | `team_section` | |
| ❓ FAQ Section | `faq_section` | |
| 📈 Stats Section | `stats_section` | |
| 💁 About Intro | `about_intro` | |
| 📚 All Posts Section | `all_posts_section` | |
| 🔄 Redirect Section | `redirect_section` | |
| 📝 Changelog Section | `changelog_section` | |

#### Nested Blocks (used within other blocks)
| Block | API Key | Parent Block |
|-------|---------|--------------|
| 🔘 Button | `button` | Hero section |
| Feature | `feature` | Feature list section |
| FAQ Item | `faq_item` | FAQ Section |
| Stat | `stat` | Stats Section |
| Brand | `brand` | Brands Section |

#### Blog Post Content Blocks (for Structured Text)
| Block | API Key | Purpose |
|-------|---------|---------|
| 🌅 Image block | `image_block` | Images in blog content |
| 📬 CTA Newsletter Subscription | `cta_newsletter_subscription` | Newsletter signup CTA |
| 📸 CTA Button with image | `cta_button_with_image` | Image + button CTA |
| 📲 CTA App Download | `app_cta` | App store download buttons |

---

### Field → Block Mapping (Complete Reference)

This section shows exactly which blocks are accepted by each Modular Content and Structured Text field.

#### Modular Content Fields

| Model | Field (API Key) | Accepted Blocks |
|-------|-----------------|-----------------|
| **Layout** | `menu` | Menu Dropdown (`menu_dropdown`), Menu Item (`menu_item`) |
| **Layout** | `social_media_links` | Social Media Icon (`social_media_icon`) |
| **Page** | `sections` | Hero section (`hero_section`), Feature list section (`feature_list_section`), Brands Section (`brands_section`), Video Section (`video_section`), Testimonials Section (`review_section`), Pricing section (`pricing_section`), Featured posts section (`featured_posts_section`), Detail section (`detail_section`), Team Section (`team_section`), FAQ Section (`faq_section`), Stats Section (`stats_section`), About Intro (`about_intro`), All Posts Section (`all_posts_section`), Redirect Section (`redirect_section`), Changelog Section (`changelog_section`) |
| **Hero section** (block) | `buttons` | Button (`button`) |
| **Feature list section** (block) | `features` | Feature (`feature`) |
| **FAQ Section** (block) | `questions` | FAQ Item (`faq_item`) |
| **Stats Section** (block) | `stats` | Stat (`stat`) |
| **Brands Section** (block) | `brands` | Brand (`brand`) |

#### Structured Text Fields (with Blocks)

| Model | Field (API Key) | Accepted Blocks | Inline Records |
|-------|-----------------|-----------------|----------------|
| **Blog Post** | `content` | Image block (`image_block`), CTA Newsletter (`cta_newsletter_subscription`), CTA Button with image (`cta_button_with_image`), CTA App Download (`app_cta`) | Blog Post (`post`) |
| **Layout** | `notification` | *(none)* | *(none)* |
| **Pricing Tier** | `tier_description` | *(none)* | *(none)* |
| **Testimonial** | `review` | *(none)* | *(none)* |
| **Documentation Page** | `content` | *(none)* | *(none)* |
| **Changelog entry** | `content` | *(none)* | *(none)* |
| **Legal Page** | `content` | *(none)* | *(none)* |

#### Link Fields (Single & Multiple)

| Model | Field (API Key) | Link Type | Target Model(s) |
|-------|-----------------|-----------|-----------------|
| **Blog Post** | `author` | Single Link | Author |
| **Blog Post** | `tags` | Multiple Links | Tag |
| **Layout** | `footer_links` | Multiple Links | Legal Page |
| **Documentation Home** | `featured_pages` | Multiple Links | Documentation Page |

#### Nested Block Hierarchy

```
Page
└── sections (Modular Content)
    ├── Hero section
    │   └── buttons (Modular Content) → Button
    ├── Feature list section
    │   └── features (Modular Content) → Feature
    ├── FAQ Section
    │   └── questions (Modular Content) → FAQ Item
    ├── Stats Section
    │   └── stats (Modular Content) → Stat
    └── Brands Section
        └── brands (Modular Content) → Brand

Layout
├── menu (Modular Content) → Menu Dropdown, Menu Item
└── social_media_links (Modular Content) → Social Media Icon

Blog Post
└── content (Structured Text)
    ├── [Blocks] → Image block, CTA Newsletter, CTA Button, CTA App Download
    └── [Inline Records] → Blog Post
```

---

### Test Target Examples

#### To test a Structured Text field with inline records:
→ Go to **Blog Post** → `content` field (can link to other Blog Posts)

#### To test nested blocks (blocks within blocks):
→ Go to **Page** → add **Hero section** → the `buttons` field accepts **Button** blocks

#### To test Modular Content with many block types:
→ Go to **Page** → `sections` field (accepts 15+ different section blocks)

#### To test DateTime field:
→ Go to **Changelog entry** → `time_of_release` field

#### To test number fields:
→ Go to **Pricing Tier** → `monthly_price` (Integer), `yearly_price` (Float)

#### To test Color field:
→ Go to **Layout** → `main_color` field

#### To test localized fields:
→ Go to **Author** → `name`, `bio`, `description` (all localized)

#### To test Single Link relationship:
→ Go to **Blog Post** → `author` field (links to Author)

#### To test Multiple Links relationship:
→ Go to **Blog Post** → `tags` field (links to multiple Tags)

---

## Unit Tests (Vitest)

Unit tests cover **pure functions** that don't require DatoCMS context.

### What to Unit Test

| Good Candidates | Why |
|-----------------|-----|
| State reducers/applicators | Pure input → output |
| Serializers/deserializers | Data transformation logic |
| Utility functions | Helpers, formatters, validators |
| Type guards | Runtime type checking |

| Poor Candidates | Why |
|-----------------|-----|
| React components with `ctx` | Needs real DatoCMS context |
| API calls | Needs real network/mocking is fragile |
| Hooks using SDK | Depends on plugin runtime |

### Vitest Configuration

**`vitest.config.ts`**:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',           // Entry point, tested via E2E
        'src/**/index.ts',        // Re-exports
      ],
    },
  },
});
```

### Example Unit Test

```typescript
// tests/unit/operationApplicators.test.ts
import { describe, it, expect } from 'vitest';
import { applyAddComment, applyDeleteComment } from '../../src/entrypoints/utils/operationApplicators';

describe('applyAddComment', () => {
  it('adds a new comment to empty state', () => {
    const state = { comments: [] };
    const newComment = {
      dateISO: '2024-01-15T10:00:00.000Z',
      content: [{ type: 'text', value: 'Hello' }],
      author: { name: 'Test', email: 'test@example.com' },
      usersWhoUpvoted: [],
    };

    const result = applyAddComment(state, newComment);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].dateISO).toBe(newComment.dateISO);
  });

  it('prepends new comment to existing comments', () => {
    const existingComment = {
      dateISO: '2024-01-14T10:00:00.000Z',
      content: [{ type: 'text', value: 'Existing' }],
      author: { name: 'Test', email: 'test@example.com' },
      usersWhoUpvoted: [],
    };
    const state = { comments: [existingComment] };
    const newComment = {
      dateISO: '2024-01-15T10:00:00.000Z',
      content: [{ type: 'text', value: 'New' }],
      author: { name: 'Test', email: 'test@example.com' },
      usersWhoUpvoted: [],
    };

    const result = applyAddComment(state, newComment);

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].dateISO).toBe(newComment.dateISO);
  });
});

describe('applyDeleteComment', () => {
  it('removes comment by dateISO', () => {
    const comment = {
      dateISO: '2024-01-15T10:00:00.000Z',
      content: [{ type: 'text', value: 'Delete me' }],
      author: { name: 'Test', email: 'test@example.com' },
      usersWhoUpvoted: [],
    };
    const state = { comments: [comment] };

    const result = applyDeleteComment(state, comment.dateISO);

    expect(result.comments).toHaveLength(0);
  });

  it('handles non-existent comment gracefully', () => {
    const state = { comments: [] };

    const result = applyDeleteComment(state, 'non-existent-iso');

    expect(result.comments).toHaveLength(0);
  });
});
```

---

## E2E Tests (Playwright)

E2E tests prove the plugin **actually works in DatoCMS**. They use a real browser, real login, real project.

### Playwright Configuration

**`playwright.config.ts`**:

```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test.local' });

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,              // DatoCMS tests should run serially
  forbidOnly: !!process.env.CI,      // Fail if .only left in CI
  retries: process.env.CI ? 2 : 0,   // Retry flaky tests in CI
  workers: 1,                         // Single worker for DatoCMS
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    trace: 'on-first-retry',
    screenshot: (process.env.PLAYWRIGHT_SCREENSHOTS as 'on' | 'off' | 'only-on-failure') || 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15000,             // DatoCMS can be slow
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: require.resolve('./tests/setup/global-setup.ts'),
  globalTeardown: require.resolve('./tests/setup/global-teardown.ts'),
});
```

### Global Setup (Create Project & Install Plugin)

**`tests/setup/global-setup.ts`**:

```typescript
import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const TEST_PROJECT_STATE_FILE = path.join(__dirname, '../e2e/.test-project.json');
const AUTH_STATE_FILE = path.join(__dirname, '../e2e/.auth/user.json');
const ORPHAN_PROJECT_PREFIX = 'e2e-test-';

interface TestProjectState {
  projectUrl: string;
  projectId: string;
  projectName: string;
}

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADED !== 'true',
    slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0'),
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // =========================================================================
    // STEP 1: Login to DatoCMS
    // =========================================================================
    console.log('🔐 Logging into DatoCMS...');

    await page.goto('https://dashboard.datocms.com/login');
    await page.fill('input[name="email"]', process.env.DATOCMS_TEST_EMAIL!);
    await page.fill('input[name="password"]', process.env.DATOCMS_TEST_PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard.datocms.com/**', { timeout: 30000 });

    console.log('✅ Logged in successfully');

    // =========================================================================
    // STEP 2: Clean up orphaned test projects from previous failed runs
    // =========================================================================
    console.log('🧹 Checking for orphaned test projects...');

    // Navigate to projects list
    await page.goto('https://dashboard.datocms.com/personal-account/projects');
    await page.waitForLoadState('networkidle');

    // Find and delete any projects matching our test pattern
    const orphanProjects = await page.locator(`a:has-text("${ORPHAN_PROJECT_PREFIX}")`).all();

    for (const projectLink of orphanProjects) {
      const projectName = await projectLink.textContent();
      console.log(`  🗑️  Deleting orphaned project: ${projectName}`);

      // Extract project ID from href and delete
      const href = await projectLink.getAttribute('href');
      if (href) {
        const projectId = href.split('/').pop();
        await deleteProject(page, projectId!);
      }
    }

    if (orphanProjects.length > 0) {
      console.log(`✅ Cleaned up ${orphanProjects.length} orphaned project(s)`);
    }

    // =========================================================================
    // STEP 3: Create fresh project from Marketing Starter template
    // =========================================================================
    console.log('🚀 Creating fresh test project from Marketing Starter...');

    const timestamp = Date.now();
    const pluginName = process.env.PLUGIN_NAME?.toLowerCase().replace(/\s+/g, '-') || 'plugin';
    const projectName = `${ORPHAN_PROJECT_PREFIX}${pluginName}-${timestamp}`;

    // Navigate to deploy wizard
    await page.goto('https://dashboard.datocms.com/deploy?repo=datocms/next-landing-page-demo:main');
    await page.waitForLoadState('networkidle');

    // Fill in project name
    const projectNameInput = page.locator('input[name="name"], input[placeholder*="project name" i]').first();
    await projectNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await projectNameInput.clear();
    await projectNameInput.fill(projectName);

    // Click through the wizard (skip optional integrations)
    // The exact steps depend on the current DatoCMS wizard UI
    // This may need adjustment based on the wizard flow

    // Look for "Create project" or "Deploy" button
    const createButton = page.locator('button:has-text("Create"), button:has-text("Deploy"), button:has-text("Continue")').first();
    await createButton.click();

    // Wait for project creation to complete
    // The wizard will redirect to the new project
    await page.waitForURL('**/*.admin.datocms.com/**', { timeout: 120000 });

    const projectUrl = page.url().split('/').slice(0, 3).join('/');
    const projectId = projectUrl.split('.')[0].replace('https://', '');

    console.log(`✅ Created project: ${projectName}`);
    console.log(`   URL: ${projectUrl}`);

    // =========================================================================
    // STEP 4: Install plugin from local dev server
    // =========================================================================
    console.log('🔌 Installing plugin from local dev server...');

    const pluginDevUrl = process.env.PLUGIN_DEV_URL || 'http://localhost:5173';

    // Navigate to private plugin installation
    await page.goto(`${projectUrl}/configuration/plugins/new-private`);
    await page.waitForLoadState('networkidle');

    // Fill in plugin URL
    const urlInput = page.locator('input[name="url"], input[placeholder*="URL" i]').first();
    await urlInput.waitFor({ state: 'visible', timeout: 10000 });
    await urlInput.fill(pluginDevUrl);

    // Submit and wait for plugin to load
    const installButton = page.locator('button:has-text("Install"), button:has-text("Add"), button[type="submit"]').first();
    await installButton.click();

    // Wait for plugin installation confirmation
    await page.waitForURL(`${projectUrl}/configuration/plugins/**`, { timeout: 30000 });

    console.log(`✅ Plugin installed from ${pluginDevUrl}`);

    // =========================================================================
    // STEP 5: Configure plugin settings (if needed)
    // =========================================================================
    const entryPoints = process.env.PLUGIN_ENTRY_POINTS?.split(',') || [];

    if (entryPoints.length > 0) {
      console.log('⚙️  Configuring plugin entry points...');

      // Plugin configuration varies by plugin type
      // This section should be customized per plugin
      // Example: Enable sidebar for all models

      for (const entryPoint of entryPoints) {
        console.log(`   Configuring: ${entryPoint.trim()}`);
        // Add entry point configuration logic here
      }

      console.log('✅ Plugin configured');
    }

    // =========================================================================
    // STEP 6: Save state for tests
    // =========================================================================
    console.log('💾 Saving test state...');

    // Save project state
    const projectState: TestProjectState = {
      projectUrl,
      projectId,
      projectName,
    };

    fs.mkdirSync(path.dirname(TEST_PROJECT_STATE_FILE), { recursive: true });
    fs.writeFileSync(TEST_PROJECT_STATE_FILE, JSON.stringify(projectState, null, 2));

    // Save authentication state
    fs.mkdirSync(path.dirname(AUTH_STATE_FILE), { recursive: true });
    await context.storageState({ path: AUTH_STATE_FILE });

    console.log('✅ Setup complete! Ready to run tests.');
    console.log('');

  } finally {
    await browser.close();
  }
}

async function deleteProject(page: any, projectId: string) {
  // Navigate to project settings page first
  await page.goto(`https://dashboard.datocms.com/personal-account/project/${projectId}`);
  await page.waitForLoadState('networkidle');

  // Scroll to Danger zone and click "Delete this project"
  const deleteButton = page.locator('button:has-text("Delete this project")').first();
  await deleteButton.scrollIntoViewIfNeeded();
  await deleteButton.click();
  await page.waitForLoadState('networkidle');

  // Fill in confirmation (requires typing the project subdomain)
  const confirmInput = page.locator('input').first();
  if (await confirmInput.isVisible()) {
    // Extract the subdomain from the confirmation text (e.g., "e2e-test-marketing-map")
    const confirmText = await page.locator('text=/type.*to confirm/i').textContent();
    const match = confirmText?.match(/\(([^)]+)\)/);
    if (match) {
      await confirmInput.fill(match[1]);
    }
  }

  const confirmDeleteButton = page.locator('button:has-text("I want to permanently delete")').first();
  await confirmDeleteButton.click();

  // Wait for deletion to complete
  await page.waitForURL('**/dashboard.datocms.com/personal-account/**', { timeout: 30000 });
}

export default globalSetup;
```

### Global Teardown (Delete Project)

**`tests/setup/global-teardown.ts`**:

```typescript
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const TEST_PROJECT_STATE_FILE = path.join(__dirname, '../e2e/.test-project.json');
const AUTH_STATE_FILE = path.join(__dirname, '../e2e/.auth/user.json');

interface TestProjectState {
  projectUrl: string;
  projectId: string;
  projectName: string;
}

async function globalTeardown() {
  // Check if we have a project to clean up
  if (!fs.existsSync(TEST_PROJECT_STATE_FILE)) {
    console.log('⚠️  No test project state found, skipping teardown');
    return;
  }

  const projectState: TestProjectState = JSON.parse(
    fs.readFileSync(TEST_PROJECT_STATE_FILE, 'utf-8')
  );

  console.log('');
  console.log('🧹 Cleaning up test project...');
  console.log(`   Project: ${projectState.projectName}`);

  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADED !== 'true',
  });

  const context = await browser.newContext({
    storageState: AUTH_STATE_FILE,
  });
  const page = await context.newPage();

  try {
    // Navigate to project settings page
    await page.goto(
      `https://dashboard.datocms.com/personal-account/project/${projectState.projectId}`
    );
    await page.waitForLoadState('networkidle');

    // Scroll to Danger zone and click "Delete this project"
    const deleteThisProjectButton = page.locator('button:has-text("Delete this project")').first();
    await deleteThisProjectButton.scrollIntoViewIfNeeded();
    await deleteThisProjectButton.click();
    await page.waitForLoadState('networkidle');

    // Fill in confirmation (requires typing the project subdomain, not the full name)
    // The subdomain is derived from the project name (lowercase, hyphens instead of spaces)
    const confirmInput = page.locator('input').first();
    if (await confirmInput.isVisible()) {
      // Extract the subdomain from the confirmation text, e.g., "(e2e-test-comments-plugin-1704067200000)"
      const confirmText = await page.locator('text=/type.*to confirm/i').textContent();
      const match = confirmText?.match(/\(([^)]+)\)/);
      if (match) {
        await confirmInput.fill(match[1]);
      }
    }

    // Click the red confirmation button
    const confirmDeleteButton = page.locator('button:has-text("I want to permanently delete")').first();
    await confirmDeleteButton.click();

    // Wait for deletion to complete
    await page.waitForURL('**/dashboard.datocms.com/personal-account/**', { timeout: 30000 });

    console.log('✅ Test project deleted');

  } catch (error) {
    console.error('❌ Failed to delete test project:', error);
    console.log('   You may need to manually delete:', projectState.projectName);
  } finally {
    await browser.close();
  }

  // Clean up local state files
  try {
    fs.unlinkSync(TEST_PROJECT_STATE_FILE);
  } catch {
    // Ignore if file doesn't exist
  }

  console.log('✅ Teardown complete');
}

export default globalTeardown;
```

### Page Object: Test Project Helper

**`tests/e2e/fixtures/dato-project.ts`**:

```typescript
import { test as base, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface TestProjectState {
  projectUrl: string;
  projectId: string;
  projectName: string;
}

const TEST_PROJECT_STATE_FILE = path.join(__dirname, '../.test-project.json');
const AUTH_STATE_FILE = path.join(__dirname, '../.auth/user.json');

// Load project state created by global setup
function loadProjectState(): TestProjectState {
  if (!fs.existsSync(TEST_PROJECT_STATE_FILE)) {
    throw new Error(
      'Test project state not found. Did global setup run successfully?'
    );
  }
  return JSON.parse(fs.readFileSync(TEST_PROJECT_STATE_FILE, 'utf-8'));
}

// Extend Playwright's test with project context
export const test = base.extend<{
  projectPage: Page;
  projectState: TestProjectState;
}>({
  projectState: async ({}, use) => {
    const state = loadProjectState();
    await use(state);
  },

  projectPage: async ({ browser, projectState }, use) => {
    const context = await browser.newContext({
      storageState: AUTH_STATE_FILE,
    });
    const page = await context.newPage();

    // Navigate to the test project
    await page.goto(projectState.projectUrl);
    await page.waitForLoadState('networkidle');

    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
export { loadProjectState };
```

### Example E2E Test (Using Fresh Project)

**`tests/e2e/sidebar.spec.ts`**:

```typescript
import { test, expect } from './fixtures/dato-project';

test.describe('Comments Sidebar', () => {
  test('plugin sidebar is available on record edit page', async ({ projectPage, projectState }) => {
    // Navigate to any record in the fresh project
    // The Marketing Starter has various content types we can use
    await projectPage.goto(`${projectState.projectUrl}/editor`);
    await projectPage.waitForLoadState('networkidle');

    // Click on first available record
    const firstRecord = projectPage.locator('[data-testid="record-row"], tr[data-record-id]').first();
    await firstRecord.click();

    // Wait for record editor to load
    await projectPage.waitForLoadState('networkidle');

    // Verify sidebar tab is visible
    const sidebarTab = projectPage.locator('text=Comments');
    await expect(sidebarTab).toBeVisible({ timeout: 10000 });
  });

  test('can add a comment to a record', async ({ projectPage, projectState }) => {
    // Navigate to a record
    await projectPage.goto(`${projectState.projectUrl}/editor`);
    await projectPage.waitForLoadState('networkidle');

    const firstRecord = projectPage.locator('[data-testid="record-row"], tr[data-record-id]').first();
    await firstRecord.click();
    await projectPage.waitForLoadState('networkidle');

    // Open comments sidebar
    const sidebarTab = projectPage.locator('text=Comments');
    await sidebarTab.click();

    // Wait for sidebar to load
    await projectPage.waitForTimeout(1000);

    // Add a comment
    const testComment = `Test comment ${Date.now()}`;
    const commentInput = projectPage.locator('[data-testid="comment-input"], textarea, [contenteditable="true"]').first();
    await commentInput.fill(testComment);

    const submitButton = projectPage.locator('button:has-text("Submit"), button:has-text("Post"), button[type="submit"]').first();
    await submitButton.click();

    // Verify comment appears
    await expect(projectPage.locator(`text=${testComment}`)).toBeVisible({ timeout: 10000 });
  });

  test('comments persist after page reload', async ({ projectPage, projectState }) => {
    // Navigate to a record
    await projectPage.goto(`${projectState.projectUrl}/editor`);
    await projectPage.waitForLoadState('networkidle');

    const firstRecord = projectPage.locator('[data-testid="record-row"], tr[data-record-id]').first();
    await firstRecord.click();
    await projectPage.waitForLoadState('networkidle');

    // Open comments sidebar and add comment
    await projectPage.locator('text=Comments').click();
    await projectPage.waitForTimeout(1000);

    const persistentComment = `Persistent ${Date.now()}`;
    const commentInput = projectPage.locator('[data-testid="comment-input"], textarea, [contenteditable="true"]').first();
    await commentInput.fill(persistentComment);
    await projectPage.locator('button:has-text("Submit"), button:has-text("Post"), button[type="submit"]').first().click();

    // Wait for comment to appear
    await expect(projectPage.locator(`text=${persistentComment}`)).toBeVisible({ timeout: 10000 });

    // Reload page
    await projectPage.reload();
    await projectPage.waitForLoadState('networkidle');

    // Re-open sidebar
    await projectPage.locator('text=Comments').click();
    await projectPage.waitForTimeout(1000);

    // Verify comment persisted
    await expect(projectPage.locator(`text=${persistentComment}`)).toBeVisible({ timeout: 10000 });
  });
});
```

---

## Bundle Exclusion

**Critical:** Tests must NEVER be included in the production bundle.

### 1. Package.json "files" Field

The `files` field whitelists what gets published to npm:

```json
{
  "name": "your-datocms-plugin",
  "files": [
    "dist"
  ],
  "devDependencies": {
    "vitest": "^1.0.0",
    "@playwright/test": "^1.40.0",
    "dotenv": "^16.0.0"
  }
}
```

### 2. Vite Configuration

Ensure Vite doesn't process test files:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Explicitly exclude test files
      external: [/^tests\//],
    },
  },
  // Exclude tests from being served in dev
  server: {
    fs: {
      deny: ['tests/**'],
    },
  },
});
```

### 3. TypeScript Configuration

Create separate configs for source and tests:

**`tsconfig.json`** (source only):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "exclude": ["tests", "node_modules", "dist"]
}
```

**`tsconfig.test.json`** (tests):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "tests"]
}
```

### 4. .npmignore (Backup)

If you don't use the `files` field:

```
# Test files
tests/
vitest.config.ts
playwright.config.ts
.env.test.local*

# Test artifacts
test-results/
playwright-report/
coverage/

# Development files
.github/
*.md
!README.md
```

### Verify Bundle Size

Always verify what gets published:

```bash
# Preview what npm will publish
npm pack --dry-run

# Check bundle size
npm run build && du -sh dist/
```

---

## CI Integration

### GitHub Actions Example

**`.github/workflows/test.yml`**:

```yaml
name: Tests

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run test:unit

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npx playwright install --with-deps chromium

      # Start the plugin dev server in background
      - name: Start plugin dev server
        run: npm run dev &
        env:
          CI: true

      # Wait for dev server to be ready
      - name: Wait for dev server
        run: npx wait-on http://localhost:5173 --timeout 30000

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          DATOCMS_TEST_EMAIL: ${{ secrets.DATOCMS_TEST_EMAIL }}
          DATOCMS_TEST_PASSWORD: ${{ secrets.DATOCMS_TEST_PASSWORD }}
          PLUGIN_DEV_URL: http://localhost:5173
          PLUGIN_NAME: ${{ github.event.repository.name }}
          PLUGIN_ENTRY_POINTS: sidebar

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:unit:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:headed": "PLAYWRIGHT_HEADED=true playwright test",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:report": "playwright show-report"
  }
}
```

---

## Writing Your First Tests

### For a New Plugin

1. **Set up test infrastructure:**
   ```bash
   npm install -D vitest @playwright/test dotenv
   npx playwright install chromium
   ```

2. **Create directory structure:**
   ```bash
   mkdir -p tests/unit tests/e2e/fixtures tests/e2e/.auth tests/setup
   ```

3. **Copy configuration files:**
   - Copy `.env.test.local.example` → `.env.test.local` and fill in credentials
   - Copy `playwright.config.ts` from this guide
   - Copy `vitest.config.ts` from this guide
   - Copy `tests/setup/global-setup.ts` from this guide
   - Copy `tests/setup/global-teardown.ts` from this guide
   - Copy `tests/e2e/fixtures/dato-project.ts` from this guide

4. **Customize for your plugin:**
   - Update `PLUGIN_ENTRY_POINTS` in `.env.test.local`
   - Modify global setup if your plugin needs specific configuration
   - Create plugin-specific page objects in `tests/e2e/fixtures/`

5. **Start the plugin dev server:**
   ```bash
   npm run dev
   ```

6. **Run tests:**
   ```bash
   npm run test:e2e
   ```

### For an Existing Plugin Without Tests

1. **Set up infrastructure** (same as above)

2. **Audit the codebase:**
   - List all pure functions → candidates for unit tests
   - List all user-facing features → candidates for E2E tests

3. **Start with E2E tests for critical paths:**
   - Plugin loads correctly
   - Main feature works (e.g., "can add a comment")
   - Data persists correctly

4. **Add unit tests for complex logic:**
   - State management
   - Data transformations
   - Validation logic

5. **Aim for confidence, not coverage percentage.** A few well-chosen tests beat many superficial ones.

---

## Checklist for Every PR

- [ ] Change has associated test (unit or E2E)
- [ ] Tests fail if implementation is reverted
- [ ] `npm run test` passes locally
- [ ] No test files in `npm pack --dry-run` output
- [ ] CI passes

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Tests flaky due to DatoCMS latency | Add explicit waits, increase timeouts |
| Project creation fails | Check DatoCMS wizard UI hasn't changed, update selectors |
| Plugin not installing | Ensure dev server is running on correct port |
| Orphaned projects accumulating | Run cleanup at start of each test run (built into global setup) |
| CI fails but local passes | Check environment variables are set in CI secrets |
| Bundle size increased | Verify `files` field in package.json, run `npm pack --dry-run` |
| Auth state expires | Global setup creates fresh auth each run |

---

## Customizing Global Setup Per Plugin

The global setup needs customization for each plugin type. Here are patterns for common plugin types:

### Sidebar Plugin

```typescript
// In global setup, after plugin installation:
// Navigate to Schema and enable sidebar for desired models
await page.goto(`${projectUrl}/admin/item_types`);
// ... enable sidebar for models
```

### Field Extension

```typescript
// In global setup, after plugin installation:
// Navigate to a model and add a field using the plugin
await page.goto(`${projectUrl}/admin/item_types/YOUR_MODEL_ID/fields/new`);
// ... configure field extension
```

### Page Plugin

```typescript
// Page plugins typically work out of the box
// Just verify the page is accessible
await page.goto(`${projectUrl}/plugins/YOUR_PLUGIN_ID`);
```

### Config Screen

```typescript
// In global setup, after plugin installation:
// Navigate to plugin settings and fill required config
await page.goto(`${projectUrl}/configuration/plugins/YOUR_PLUGIN_ID`);
// ... fill configuration form
```

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [DatoCMS Plugin SDK](https://www.datocms.com/docs/plugin-sdk)
- [DatoCMS CMA Client](https://www.datocms.com/docs/content-management-api)
