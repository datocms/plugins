import { describe, it, expect } from 'vitest';
import { getGravatarUrl, getThumbnailUrl } from '@/utils/helpers';
import md5 from 'md5';

describe('getGravatarUrl', () => {
  describe('URL generation', () => {
    it('generates correct gravatar URL with email hash', () => {
      const email = 'test@example.com';
      const result = getGravatarUrl(email);

      const expectedHash = md5(email);
      expect(result).toBe(`https://www.gravatar.com/avatar/${expectedHash}?d=mp&s=64`);
    });

    it('uses default size of 64', () => {
      const result = getGravatarUrl('test@example.com');

      expect(result).toContain('s=64');
    });

    it('uses custom size when provided', () => {
      const result = getGravatarUrl('test@example.com', 128);

      expect(result).toContain('s=128');
    });

    it('uses mp (mystery person) as default avatar', () => {
      const result = getGravatarUrl('test@example.com');

      expect(result).toContain('d=mp');
    });
  });

  describe('email hashing', () => {
    it('produces consistent hash for same email', () => {
      const url1 = getGravatarUrl('user@test.com');
      const url2 = getGravatarUrl('user@test.com');

      expect(url1).toBe(url2);
    });

    it('produces different hash for different emails', () => {
      const url1 = getGravatarUrl('user1@test.com');
      const url2 = getGravatarUrl('user2@test.com');

      expect(url1).not.toBe(url2);
    });

    it('handles empty email', () => {
      const result = getGravatarUrl('');

      expect(result).toContain('https://www.gravatar.com/avatar/');
    });
  });
});

describe('getThumbnailUrl', () => {
  describe('image thumbnails', () => {
    it('returns thumbnail URL for images', () => {
      const result = getThumbnailUrl('image/jpeg', 'https://cdn.example.com/image.jpg');

      expect(result).toBe('https://cdn.example.com/image.jpg?w=300&fit=max&auto=format');
    });

    it('uses custom width', () => {
      const result = getThumbnailUrl('image/png', 'https://cdn.example.com/image.png', null, 500);

      expect(result).toContain('w=500');
    });

    it('handles different image mime types', () => {
      expect(getThumbnailUrl('image/png', 'https://example.com/a.png')).toBeTruthy();
      expect(getThumbnailUrl('image/gif', 'https://example.com/a.gif')).toBeTruthy();
      expect(getThumbnailUrl('image/webp', 'https://example.com/a.webp')).toBeTruthy();
      expect(getThumbnailUrl('image/svg+xml', 'https://example.com/a.svg')).toBeTruthy();
    });

    it('returns null when image URL is null', () => {
      const result = getThumbnailUrl('image/jpeg', null);

      expect(result).toBeNull();
    });
  });

  describe('video thumbnails', () => {
    it('returns Mux thumbnail URL for videos with playback ID', () => {
      const result = getThumbnailUrl('video/mp4', 'https://example.com/video.mp4', 'mux123abc');

      expect(result).toBe('https://image.mux.com/mux123abc/thumbnail.jpg?width=300&fit_mode=preserve');
    });

    it('uses custom width for video thumbnails', () => {
      const result = getThumbnailUrl('video/mp4', null, 'mux123', 640);

      expect(result).toContain('width=640');
    });

    it('returns null for video without Mux playback ID', () => {
      const result = getThumbnailUrl('video/mp4', 'https://example.com/video.mp4', null);

      expect(result).toBeNull();
    });

    it('handles different video mime types', () => {
      expect(getThumbnailUrl('video/mp4', null, 'mux123')).toBeTruthy();
      expect(getThumbnailUrl('video/webm', null, 'mux123')).toBeTruthy();
      expect(getThumbnailUrl('video/quicktime', null, 'mux123')).toBeTruthy();
    });
  });

  describe('non-media files', () => {
    it('returns null for PDF', () => {
      const result = getThumbnailUrl('application/pdf', 'https://example.com/doc.pdf');

      expect(result).toBeNull();
    });

    it('returns null for text files', () => {
      const result = getThumbnailUrl('text/plain', 'https://example.com/file.txt');

      expect(result).toBeNull();
    });

    it('returns null for audio files', () => {
      const result = getThumbnailUrl('audio/mpeg', 'https://example.com/audio.mp3');

      expect(result).toBeNull();
    });

    it('returns null for zip files', () => {
      const result = getThumbnailUrl('application/zip', 'https://example.com/archive.zip');

      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty mime type', () => {
      const result = getThumbnailUrl('', 'https://example.com/file');

      expect(result).toBeNull();
    });

    it('handles undefined mux playback ID', () => {
      const result = getThumbnailUrl('video/mp4', 'https://example.com/video.mp4', undefined);

      expect(result).toBeNull();
    });
  });
});
