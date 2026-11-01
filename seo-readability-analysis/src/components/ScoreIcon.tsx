import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import * as interpreters from 'yoastseo/build/scoring/interpreters';

const TONES: Partial<Record<string, 'danger' | 'warning' | 'success'>> = {
  bad: 'danger',
  ok: 'warning',
  good: 'success',
};

const WORDS: Partial<Record<string, string>> = {
  bad: 'Needs improvement',
  ok: 'OK',
  good: 'Good',
};

type PropTypes = {
  score?: number | null;
  rating?: string | null;
  /** The dot is the only sign of the rating: the screen readers read it */
  ariaLabel?: boolean;
};

export default function ScoreIcon({ rating, score, ariaLabel }: PropTypes) {
  const scoreRating = rating || interpreters.scoreToRating(score);

  return (
    <FeedbackDot
      tone={TONES[scoreRating] ?? 'neutral'}
      ariaLabel={
        ariaLabel ? (WORDS[scoreRating] ?? 'Not available') : undefined
      }
    />
  );
}
