import { type CSSProperties, useState } from 'react';
import type { ShopifyImage } from '../../types';
import styles from './Thumbnail.module.css';

type Props = {
  image: ShopifyImage | null | undefined;
  /** Box size in px (square), or omit and size the frame with className. */
  size?: number;
  /** Records are cropped (cover); full product shots can use contain. */
  fit?: 'cover' | 'contain';
  radius?: number;
  className?: string;
  /**
   * Alt text, only for an image that stands alone. Every current thumbnail
   * sits next to its item's visible title, so it is decorative by default:
   * Shopify's alt texts are often long scene descriptions that screen readers
   * would announce before the title.
   */
  alt?: string;
};

/**
 * A product, variant or collection thumbnail. Without an image it is a plain
 * surface-muted swatch (no icon), as in the dashboard. Images load lazily and
 * fade in. Decorative unless given an `alt` (Shopify's `altText` is ignored).
 */
export default function Thumbnail({
  image,
  size,
  fit = 'cover',
  radius,
  className,
  alt = '',
}: Props) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const style: CSSProperties = {};
  if (size !== undefined) {
    style.width = size;
    style.height = size;
  }
  if (radius !== undefined) style.borderRadius = radius;

  const url = image?.url ?? null;

  return (
    <span
      className={[styles.frame, className].filter(Boolean).join(' ')}
      style={style}
    >
      {url && (
        <img
          key={url}
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={[
            styles.image,
            fit === 'contain' ? styles.contain : styles.cover,
            loadedUrl === url ? styles.loaded : '',
          ].join(' ')}
          onLoad={() => setLoadedUrl(url)}
        />
      )}
    </span>
  );
}
