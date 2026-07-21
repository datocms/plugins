import styles from './ValidityIndicators.module.css';

export type ValidityIndicatorsProps = {
  publishedValid?: boolean | null;
  currentValid?: boolean | null;
  draftModeActive?: boolean | null;
};

function PublishedVersionInvalidIcon() {
  return (
    <svg aria-label="Published version is invalid" viewBox="0 0 512 512">
      <title>Published version is invalid</title>
      <path d="M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7.2 40.1S486.3 480 472 480H40c-14.3 0-27.6-7.7-34.7-20.1s-7.1-27.7.2-40.1l216-368A39.9 39.9 0 0 1 256 32Zm0 128c-13.3 0-24 10.7-24 24v112c0 13.3 10.7 24 24 24s24-10.7 24-24V184c0-13.3-10.7-24-24-24Zm32 224a32 32 0 1 0-64 0 32 32 0 1 0 64 0Z" />
    </svg>
  );
}

function CurrentVersionInvalidIcon() {
  return (
    <svg aria-label="Current version is invalid" viewBox="0 0 512 512">
      <title>Current version is invalid</title>
      <path d="M256 48a208 208 0 1 0 0 416 208 208 0 1 0 0-416Zm0 96a28 28 0 1 1 0 56 28 28 0 1 1 0-56Zm-32 96h32c13.3 0 24 10.7 24 24v80h8c13.3 0 24 10.7 24 24s-10.7 24-24 24h-64c-13.3 0-24-10.7-24-24s10.7-24 24-24h8v-56h-8c-13.3 0-24-10.7-24-24s10.7-24 24-24Z" />
    </svg>
  );
}

export function ValidityIndicators({
  publishedValid,
  currentValid,
  draftModeActive,
}: ValidityIndicatorsProps) {
  const showPublished = publishedValid === false;
  const showCurrent = Boolean(draftModeActive) && currentValid === false;
  if (!showPublished && !showCurrent) return null;

  return (
    <span
      className={`${styles.wrapper} ${showPublished && showCurrent ? styles.double : ''}`}
    >
      {showPublished && <PublishedVersionInvalidIcon />}
      {showCurrent && <CurrentVersionInvalidIcon />}
    </span>
  );
}
