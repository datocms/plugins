# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` - Start development server on http://localhost:5173
- `npm run build` - Build for production (TypeScript check + Vite build)
- `npm run preview` - Preview production build locally

Note: No linting or testing commands are configured in this project.

## Architecture Overview

This is a DatoCMS plugin that duplicates content between locales. The plugin is built with:
- Vite + React + TypeScript
- DatoCMS Plugin SDK for integration
- CMA Client Browser for API operations

### Key Components

- **Entry Point**: `src/main.tsx` - Connects the DatoCMS Plugin SDK with three entrypoints
- **Config Screen**: `src/entrypoints/ConfigScreen.tsx` - Field selection and configuration UI
- **Settings Sidebar**: `src/entrypoints/SettingsAreaSidebar.tsx` - Mass locale duplication interface
- **Field Extension**: `src/entrypoints/FieldExtension.tsx` - Copy buttons for individual fields
- **Build Output**: `dist/index.html` - Single HTML file loaded by DatoCMS

### Plugin Functionality

The plugin provides two main features:

**Mass Duplication (Settings Area)**:
1. Select source and target locales
2. Choose specific models to duplicate (with select all/none options)
3. Display real-time progress during duplication
4. Show comprehensive summary with success/failure statistics

**Field-Level Copying (Record Editor)**:
1. Configure which fields should have copy buttons
2. Copy field content between locales while editing records
3. Supports common field types (string, text, structured text, JSON, SEO, slug)

### DatoCMS Integration

- Requires `currentUserAccessToken` permission to access CMA API
- Handles all DatoCMS record types including nested blocks and structured text
- Supports locale formats: ISO-639-1 codes and country variations (e.g., en-US)

## Development Notes

- Plugin logic is split across three entrypoints: `ConfigScreen.tsx`, `SettingsAreaSidebar.tsx`, and `FieldExtension.tsx`
- Uses inline styles and CSS modules for styling
- No environment-specific configuration needed - API tokens are provided by DatoCMS at runtime
- The mass duplication feature overwrites all content in the target locale - this is by design
- Field configurations are stored in plugin parameters and persisted across sessions

## Design Principles

- For design principles always use datocms-react-ui and the principles detailed at https://www.datocms.com/docs/plugin-sdk/react-datocms-ui

## Feature Overview

The plugin provides two distinct features for locale content management:

### 1. Mass Locale Duplication
- Bulk duplicate content across all records in selected models from one locale to another
- Accessible from Settings > Locale Duplicate via `SettingsAreaSidebar.tsx`
- Use case: Migrating content between locales or setting up similar locales

### 2. Field-Level Copy Feature
- Copy buttons appear on configured fields in the record editing interface
- Configure fields via the plugin's configuration screen (`ConfigScreen.tsx`)
- Implemented via `FieldExtension.tsx` for supported field types:
  - string, text, structured_text, json, seo, slug
- Use case: Selective field copying during content editing workflow

### Plugin Architecture
- **ConfigScreen.tsx**: Field configuration UI for selecting which fields get copy buttons
- **SettingsAreaSidebar.tsx**: Mass duplication interface for bulk operations
- **FieldExtension.tsx**: Renders copy buttons on configured fields
- Field configurations stored in plugin parameters and accessed via DatoCMS Plugin SDK

## Development Guidelines

- Always build to test for errors

  ## CRITICAL: DatoCMS Documentation Requirements

  ❗ MANDATORY: Use the datocms-documentation-rag tool BEFORE:
  - Analyzing any DatoCMS codebase
  - Suggesting code improvements
  - Writing new code
  - Answering questions about DatoCMS functionality

  This is NOT optional. Even for simple tasks, check if DatoCMS has specific guidance.
