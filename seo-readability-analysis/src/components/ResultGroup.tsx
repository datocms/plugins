import Button from 'datocms-react-ui/Button';
import CardList from 'datocms-react-ui/CardList';
import { memo, useEffect, useRef, useState } from 'react';
import { EyeIcon } from '../icons';
import type { AnalysisResult } from '../types';
import ScoreIcon from './ScoreIcon';
import s from './styles.module.css';

/**
 * Renders a trusted HTML string from the Yoast analysis library by setting
 * innerHTML via a ref, which avoids the dangerouslySetInnerHTML lint rule.
 * The content here comes exclusively from the Yoast SEO library (not user input).
 */
const TrustedHtml = ({
  html,
  className,
}: {
  html: string;
  className?: string;
}) => {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  return <p ref={ref} className={className} />;
};

export type Group = {
  scoreKey: string;
  title: string;
  items: AnalysisResult[];
};

const Marks = ({ marks }: { marks: NonNullable<AnalysisResult['marks']> }) => (
  <div className={s.marks}>
    {marks.map((mark) => {
      const { marked, original, position } = mark._properties;
      const key = position ? String(position.startOffset) : original;

      // A mark by position is a whole sentence or paragraph, as plain text
      if (!marked) {
        return (
          <p key={key} className={s.mark}>
            {original}
          </p>
        );
      }

      const wholeSentenceHighlighted =
        marked.indexOf('<yoastmark') === 0 &&
        marked.endsWith('</yoastmark>') &&
        marked.split('</yoastmark>').length === 2;

      return (
        <TrustedHtml
          key={key}
          html={marked}
          className={
            wholeSentenceHighlighted
              ? s.mark
              : `${s.mark} ${s.markWithHighlights}`
          }
        />
      );
    })}
  </div>
);

const ResultItem = memo(({ item }: { item: AnalysisResult }) => {
  const [marksOpen, setMarksOpen] = useState(false);
  const marks = item.marks && item.marks.length > 0 ? item.marks : null;

  return (
    <CardList.Item
      row={{
        summary: <TrustedHtml html={item.text} className={s.resultText} />,
        actions: marks && (
          <Button
            tone="ghost"
            size="micro"
            iconOnly
            icon={EyeIcon}
            label="Show the marked text"
            pressed={marksOpen}
            onClick={() => setMarksOpen((open) => !open)}
          />
        ),
      }}
      body={marks && marksOpen ? <Marks marks={marks} /> : undefined}
    />
  );
});

type PropTypes = {
  rating: string;
  result: Group;
  startOpen: boolean;
};

export default function ResultGroup({ rating, result, startOpen }: PropTypes) {
  const [isOpen, setIsOpen] = useState(startOpen);

  return (
    <CardList
      header={{
        image: <ScoreIcon rating={rating} />,
        title: result.title,
        aside: String(result.items.length),
        collapse: { open: isOpen, onToggle: () => setIsOpen((open) => !open) },
      }}
      actionsVisibility="always"
    >
      {result.items.map((item) => (
        <ResultItem item={item} key={item._identifier} />
      ))}
    </CardList>
  );
}
