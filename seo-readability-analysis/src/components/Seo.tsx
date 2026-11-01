import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import StringInput from 'datocms-react-ui/StringInput';
import TableList, { type TableListColumn } from 'datocms-react-ui/TableList';
import { useMemo } from 'react';
import type { Analysis } from '../types';
import Results from './Results';
import s from './styles.module.css';

type RelatedKeyword = { keyword: string; synonyms: string };

type PropTypes = {
  keyword: string;
  synonyms: string;
  setKeyword: (value: string) => void;
  setSynonyms: (value: string) => void;
  relatedKeywords: RelatedKeyword[];
  setRelatedKeywords: (value: RelatedKeyword[]) => void;
  analysis: Analysis | null;
};

const newRelatedKeyword = (): RelatedKeyword => ({ keyword: '', synonyms: '' });

function Seo({
  keyword,
  synonyms,
  setKeyword,
  setSynonyms,
  relatedKeywords,
  setRelatedKeywords,
  analysis,
}: PropTypes) {
  const columns = useMemo<TableListColumn<RelatedKeyword>[]>(
    () => [
      { id: 'keyword', field: 'keyword', label: 'Keyword' },
      { id: 'synonyms', field: 'synonyms', label: 'Synonyms' },
    ],
    [],
  );

  return (
    <>
      <div className="form__field form__row">
        <div className="form__row__cell">
          <FieldWrapper label="Focus keyword">
            {/* An empty input gives null: the stored value keeps strings */}
            <StringInput
              placeholder="vegan recipes"
              value={keyword}
              onChange={(value) => setKeyword(value ?? '')}
            />
          </FieldWrapper>
        </div>
        <div className="form__row__cell">
          <FieldWrapper
            label="Synonyms"
            hint="Separate the synonyms with commas."
          >
            <StringInput
              placeholder="plant-based recipes, vegetarian recipes"
              value={synonyms}
              onChange={(value) => setSynonyms(value ?? '')}
            />
          </FieldWrapper>
        </div>
      </div>
      {keyword && analysis?.seo && (
        <div className={s.block}>
          <Results assessment={analysis.seo} key={keyword} />
        </div>
      )}
      {(keyword || relatedKeywords.length > 0) && (
        <FieldWrapper label="Related keywords">
          <TableList<RelatedKeyword>
            value={relatedKeywords}
            onChange={setRelatedKeywords}
            columns={columns}
            emptyMessage="No related keywords"
            add={
              keyword
                ? { label: 'Add related keyword', newItem: newRelatedKeyword }
                : undefined
            }
          />
        </FieldWrapper>
      )}
      {relatedKeywords.map((related, i) => {
        const assessment = analysis?.relatedKeywordsSeo[i];

        if (!related.keyword || !assessment) {
          return null;
        }

        return (
          // The rows have no id: the analysis follows the index of the row
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={i} className={s.block}>
            <p className={s.relatedTitle}>
              Related keyword “{related.keyword}”
            </p>
            <Results assessment={assessment} key={related.keyword} />
          </div>
        );
      })}
    </>
  );
}

export default Seo;
