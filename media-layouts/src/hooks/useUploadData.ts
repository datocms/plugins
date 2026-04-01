import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { useEffect, useState } from 'react';
import type { Upload } from '../types';

async function fetchUploadFromApi(
  uploadId: string,
  accessToken: string | null,
): Promise<Upload> {
  const response = await fetch(
    `https://site-api.datocms.com/uploads/${uploadId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'X-Api-Version': '3',
      },
    },
  );

  if (!response.ok) {
    throw new Error('Failed to fetch upload');
  }

  const json = await response.json();
  return json.data as Upload;
}

export function useUploadData(
  ctx: RenderFieldExtensionCtx,
  uploadId: string | null,
  skip = false,
) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadId || skip) {
      setUpload(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchUpload() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchUploadFromApi(
          uploadId as string,
          ctx.currentUserAccessToken,
        );
        if (!cancelled) {
          setUpload(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load upload data');
          console.error('Upload fetch error:', err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchUpload();

    return () => {
      cancelled = true;
    };
  }, [uploadId, ctx.currentUserAccessToken, skip]);

  return { upload, loading, error };
}
