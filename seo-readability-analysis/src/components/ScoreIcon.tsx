import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import * as interpreters from 'yoastseo/build/scoring/interpreters';

const TONES: Partial<Record<string, 'danger' | 'warning' | 'success'>> = {
  bad: 'danger',
  ok: 'warning',
  good: 'success',
};

type PropTypes = {
  score?: number | null;
  rating?: string | null;
};

export default function ScoreIcon({ rating, score }: PropTypes) {
  const scoreRating = rating || interpreters.scoreToRating(score);

  return <FeedbackDot tone={TONES[scoreRating] ?? 'neutral'} />;
}
