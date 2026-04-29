import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Form, TextField } from 'datocms-react-ui';
import { useState } from 'react';
import { splitKeywords } from '../utils/buildAssetsSearchUrl';
import s from './SearchModal.module.css';

type Props = {
  ctx: RenderModalCtx;
};

export default function SearchModal({ ctx }: Props) {
  const [keywords, setKeywords] = useState('');

  const trimmedHasKeywords = splitKeywords(keywords).length > 0;

  const handleSubmit = () => {
    if (!trimmedHasKeywords) {
      return;
    }
    ctx.resolve(keywords);
  };

  const handleCancel = () => {
    ctx.resolve(null);
  };

  return (
    <Canvas ctx={ctx}>
      <Form onSubmit={handleSubmit} className={s.form}>
        <TextField
          required
          id="smarter-image-search-keywords"
          name="keywords"
          label="Keywords"
          value={keywords}
          onChange={setKeywords}
          placeholder="e.g. hornet 750"
          hint="Whitespace-separated. Each keyword must appear somewhere in the filename — order doesn't matter."
          textInputProps={{ autoFocus: true }}
        />
        <footer className={s.footer}>
          <Button type="button" buttonType="muted" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            buttonType="primary"
            disabled={!trimmedHasKeywords}
          >
            Search assets
          </Button>
        </footer>
      </Form>
    </Canvas>
  );
}
