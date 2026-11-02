import { type ReactNode, useState } from 'react';
import type { ShopifyImage } from '../../types';
import styles from './Thumbnail.module.css';

type Props = {
  image: ShopifyImage | null | undefined;
  /** Records are cropped (cover); full product shots can use contain. */
  fit?: 'cover' | 'contain';
  /**
   * Shown centered on the swatch when there is no image, or it fails to
   * load: the icon of the item's kind (`KindIcon`), or the eye-slash of an
   * item the storefront doesn't show.
   */
  fallback?: ReactNode;
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
 * muted swatch (with the `fallback`, if any). Images load lazily and fade in,
 * except with reduced motion. Decorative unless given an `alt` (Shopify's
 * `altText` is ignored). Its place gives its size and its corners: the image
 * slot of an `EntityRow`, or the `className` of a card's media.
 */
export default function Thumbnail({
  image,
  fit = 'cover',
  fallback,
  className,
  alt = '',
}: Props) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const url = image?.url ?? null;
  const showImage = url !== null && failedUrl !== url;

  return (
    <span className={[styles.frame, className].filter(Boolean).join(' ')}>
      {showImage ? (
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
          onError={() => setFailedUrl(url)}
        />
      ) : (
        fallback && <span className={styles.fallback}>{fallback}</span>
      )}
    </span>
  );
}
