import { useState } from 'react';
import { ImageIcon } from '../icons';
import styles from './Thumbnail.module.css';

type Props = {
  /** The image of the product, or null when Centra has none */
  url: string | null;
};

/**
 * A product picture, in the image slot of an EntityRow. The image is
 * decorative (the row names the product next to it), loads lazily and shows
 * whole. Without an image, or when it fails to load, an image glyph stands in
 * its place.
 */
export default function Thumbnail({ url }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && url !== failedUrl;

  return (
    <span className={styles.frame}>
      {showImage ? (
        <img
          key={url}
          className={styles.image}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span className={styles.fallback}>
          <ImageIcon />
        </span>
      )}
    </span>
  );
}
