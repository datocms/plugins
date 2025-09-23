import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useEffect, useState } from 'react';
import type { ExportDoc } from '@/utils/types';
import { ExportSchema } from '../ExportPage/ExportSchema';

type RecipeLoaderResult = {
  loading: boolean;
};

type RecipeLoadedCallback = (payload: {
  label: string;
  schema: ExportSchema;
}) => void;

type RecipeLoaderOptions = {
  onError?: (error: unknown) => void;
};

/**
 * Watches the page URL for the optional recipe parameters and hydrates an export schema
 * when present, exposing a simple loading flag to the caller.
 */
export function useRecipeLoader(
  ctx: RenderPageCtx,
  onLoaded: RecipeLoadedCallback,
  { onError }: RecipeLoaderOptions = {},
): RecipeLoaderResult {
  const [loading, setLoading] = useState(false);
  const locationSearch = ctx.location.search;

  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const recipeUrlValue = params.get('recipe_url');
    if (!recipeUrlValue) {
      return;
    }
    const recipeUrl = recipeUrlValue;

    const recipeTitle = params.get('recipe_title');
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        const response = await fetch(recipeUrl);
        const body = (await response.json()) as ExportDoc;
        const schema = new ExportSchema(body);
        if (cancelled) return;
        const parsedUrl = new URL(recipeUrl);
        const fallbackName =
          parsedUrl.pathname.split('/').pop() || 'Imported schema';
        onLoaded({
          label: recipeTitle || fallbackName,
          schema,
        });
      } catch (error) {
        if (!cancelled) {
          onError?.(error);
          console.error('Failed to load recipe export', error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [locationSearch, onLoaded, onError]);

  return { loading };
}
