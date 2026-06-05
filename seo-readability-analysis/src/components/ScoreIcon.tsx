import * as interpreters from 'yoastseo/build/scoring/interpreters';

const scoreRatingColorMapping: Partial<Record<string, string>> = {
  feedback: 'var(--color--ink-subtle)',
  bad: 'var(--color--danger-soft--ink)',
  ok: 'var(--color--warning-soft--ink)',
  good: 'var(--color--success-soft--ink)',
};

type PropTypes = {
  score?: number | null;
  rating?: string | null;
};
export default function ScoreIcon({ rating, score }: PropTypes) {
  const scoreRating = rating || interpreters.scoreToRating(score);
  const scoreColor =
    scoreRatingColorMapping[scoreRating] || scoreRatingColorMapping.feedback;

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        fill={scoreColor}
        width="10"
        height="10"
      >
        <path d="M256 0C115.39 0 0 115.39 0 256s115.39 256 256 256 256-115.39 256-256S396.61 0 256 0z" />
      </svg>{' '}
    </>
  );
}
