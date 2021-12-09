import { AnalysisAssessment } from '../types';
import Results from './Results';
import { TextField, Button } from 'datocms-react-ui';

type PropTypes = {
  analysis?: AnalysisAssessment;
  keyword: string;
  synonyms: string;
  setKeyword: (val: string) => void;
  setSynonyms: (val: string) => void;
  onRemove?: () => void;
};

function Seo({
  analysis,
  keyword,
  synonyms,
  setKeyword,
  setSynonyms,
  onRemove,
}: PropTypes) {
  return (
    <div className="Plugin__seo">
      <div className="Plugin__form">
        <div className="Plugin__form__field">
          <TextField
            id="keyword"
            name="keyword"
            label="Focus keyword"
            placeholder="Enter focus keyword"
            value={keyword}
            onChange={setKeyword}
          />
        </div>
        <div className="Plugin__form__field">
          <TextField
            id="synonyms"
            name="synonyms"
            label="Synonyms (separate with commas)"
            placeholder="Enter keyword synonyms"
            value={synonyms}
            onChange={setSynonyms}
          />
        </div>
      </div>
      {analysis && keyword && <Results assessment={analysis} key={keyword} />}
      {onRemove && (
        <Button
          type="button"
          buttonType="negative"
          buttonSize="xs"
          onClick={onRemove}
        >
          Remove this keyword
        </Button>
      )}
    </div>
  );
}

export default Seo;
