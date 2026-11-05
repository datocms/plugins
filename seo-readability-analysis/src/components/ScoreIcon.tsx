import FeedbackDot from 'datocms-react-ui/FeedbackDot';

const TONES: Partial<Record<string, 'danger' | 'warning' | 'success'>> = {
  bad: 'danger',
  ok: 'warning',
  good: 'success',
};

/** The dot of a group of results, next to its title */
export default function ScoreIcon({ rating }: { rating: string }) {
  return <FeedbackDot tone={TONES[rating] ?? 'neutral'} />;
}
