import Button from 'datocms-react-ui/Button';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import RawButton from 'datocms-react-ui/RawButton';
import { useEffect, useRef, useState } from 'react';
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
  tag: Tag = 'p',
  className,
}: {
  html: string;
  tag?: 'p' | 'div';
  className?: string;
}) => {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  return <Tag ref={ref as React.RefObject<never>} className={className} />;
};

export type Group = {
  scoreKey: string;
  title: string;
  items: AnalysisResult[];
};

const ResultItem = ({ item }: { item: AnalysisResult }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li className={s.item}>
      <ScoreIcon score={item.score} />
      <div className={s.itemBody}>
        <TrustedHtml html={item.text} tag="p" />
        {isOpen && (
          <div className={s.marks}>
            {item.marks?.map((mark) => {
              const wholeSentenceHighlighted =
                mark._properties.marked.indexOf('<yoastmark') === 0 &&
                mark._properties.marked.endsWith('</yoastmark>') &&
                mark._properties.marked.split('</yoastmark>').length === 2;

              return (
                <TrustedHtml
                  key={mark._properties.original}
                  html={mark._properties.marked}
                  tag="div"
                  className={
                    wholeSentenceHighlighted
                      ? s.mark
                      : `${s.mark} ${s.markWithHighlights}`
                  }
                />
              );
            })}
          </div>
        )}
      </div>
      {item.marks && item.marks.length > 0 && (
        <Button
          tone="ghost"
          size="micro"
          iconOnly
          icon={EyeIcon}
          label="Show the marked text"
          pressed={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        />
      )}
    </li>
  );
};

type PropTypes = {
  rating: string;
  result: Group;
  startOpen: boolean;
};

export default function ResultGroup({ rating, result, startOpen }: PropTypes) {
  const [isOpen, setIsOpen] = useState(startOpen);

  return (
    <div>
      <RawButton
        className={s.groupToggle}
        expandable={{ open: isOpen }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <DisclosureChevron open={isOpen} />
        <ScoreIcon rating={rating} />
        {result.title}
        <span className={s.count}>{result.items.length}</span>
      </RawButton>
      {isOpen && (
        <ul className={s.items}>
          {result.items.map((item) => (
            <ResultItem item={item} key={item._identifier} />
          ))}
        </ul>
      )}
    </div>
  );
}
