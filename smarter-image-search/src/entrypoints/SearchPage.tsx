import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAssetsSearchUrl } from '../utils/buildAssetsSearchUrl';
import s from './SearchPage.module.css';

type Props = {
  ctx: RenderPageCtx;
};

export const SEARCH_MODAL_ID = 'smarter-image-search';

export default function SearchPage({ ctx }: Props) {
  const [isOpening, setIsOpening] = useState(false);
  const autoOpenedRef = useRef(false);

  const openSearch = useCallback(async () => {
    setIsOpening(true);
    try {
      const result = await ctx.openModal({
        id: SEARCH_MODAL_ID,
        title: 'Smarter image search',
        width: 's',
      });

      if (typeof result !== 'string') {
        return;
      }

      const url = buildAssetsSearchUrl(result);
      if (url) {
        ctx.navigateTo(url);
      }
    } finally {
      setIsOpening(false);
    }
  }, [ctx]);

  useEffect(() => {
    if (autoOpenedRef.current) {
      return;
    }
    autoOpenedRef.current = true;
    openSearch();
  }, [openSearch]);

  return (
    <Canvas ctx={ctx}>
      <div className={s.placeholder}>
        <h2 className={s.heading}>Smarter image search</h2>
        <p className={s.description}>
          Search the Media Area for filenames containing every keyword you
          enter, in any order.
        </p>
        <Button
          buttonType="primary"
          buttonSize="l"
          onClick={openSearch}
          disabled={isOpening}
        >
          {isOpening ? 'Search open…' : 'Open search'}
        </Button>
      </div>
    </Canvas>
  );
}
