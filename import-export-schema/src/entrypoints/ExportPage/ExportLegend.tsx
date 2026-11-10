import classNames from 'classnames';
import s from './styles.module.css';

/**
 * The key of the export graph, always under it: what a tinted box, a dashed
 * box, a solid link and a dashed link mean, and how to change what goes in
 * the file. Each sample draws what the graph draws, next to its word.
 */
export function ExportLegend() {
  return (
    <div className={s.legend}>
      <ul className={s.legendItems} aria-label="Legend">
        <li className={s.legendItem}>
          <span
            className={classNames(s.swatch, s.swatchIncluded)}
            aria-hidden="true"
          />
          Included
        </li>
        <li className={s.legendItem}>
          <span
            className={classNames(s.swatch, s.swatchExcluded)}
            aria-hidden="true"
          />
          Not exported
        </li>
        <li className={s.legendItem}>
          <span className={s.line} aria-hidden="true" />
          Link exported
        </li>
        <li className={s.legendItem}>
          <span
            className={classNames(s.line, s.lineExcluded)}
            aria-hidden="true"
          />
          Link not exported
        </li>
      </ul>
      <span>Click a box, or press Enter on it, to include or exclude it.</span>
    </div>
  );
}
