import { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import {
  Button,
  SelectInput,
  Spinner,
  TextInput,
  useCtx,
  useElementLayout,
} from 'datocms-react-ui';
import { createApi, OrderBy } from 'unsplash-js';
import classNames from 'classnames';
import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Basic as Photo } from 'unsplash-js/dist/methods/photos/types';
import s from './styles.module.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';
import Cell from '../components/Cell';

const PER_PAGE = 30;

const unsplash = createApi({
  apiUrl: 'https://www.datocms.com/api/unsplash-proxy',
});

type Orientation = 'all' | 'landscape' | 'portrait' | 'squarish';

type Color =
  | 'all'
  | 'white'
  | 'black'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'purple'
  | 'magenta'
  | 'green'
  | 'teal'
  | 'blue'
  | 'black_and_white';

type Response = {
  results: Photo[];
  total: number;
};

type Chunk<T> = { items: T[]; total: number };

function chunkArray<T extends Photo>(array: T[], chunks: number): T[][] {
  const results: Chunk<T>[] = [...new Array(chunks)].map(() => ({
    items: [],
    total: 0,
  }));

  array.forEach((item) => {
    const minCol = results.reduce<Chunk<T> | null>((winner, col, i) => {
      return !winner || col.total < winner.total ? col : winner;
    }, null);

    if (!minCol) {
      return;
    }

    minCol.items.push(item);
    minCol.total += (1.0 * item.height) / item.width;
  });

  return results.map((c) => c.items);
}

const orientationOptions: Array<{ value: Orientation; label: string }> = [
  { value: 'all', label: 'Any orientation' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'squarish', label: 'Square' },
];

const colorOptions: Array<{ value: Color; label: string }> = [
  { value: 'all', label: 'Any color' },
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'orange', label: 'Orange' },
  { value: 'red', label: 'Red' },
  { value: 'purple', label: 'Purple' },
  { value: 'magenta', label: 'Magenta' },
  { value: 'green', label: 'Green' },
  { value: 'teal', label: 'Teal' },
  { value: 'blue', label: 'Blue' },
  { value: 'black_and_white', label: 'Black & white' },
];

const AssetBrowser = () => {
  const ctx = useCtx<RenderAssetSourceCtx>();
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('all');
  const [color, setColor] = useState<Color>('all');
  const [page, setPage] = useState(1);
  const [photos, setPhotos] = useState<Response | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const handleSelect = useCallback(
    async (photo: Photo) => {
      unsplash.photos.trackDownload({
        downloadLocation: photo.links.download_location,
      });

      ctx.select({
        resource: {
          url: `${photo.urls.raw}&w=2500&fm=jpg&q=80&fit=max`,
          filename: `${
            photo.alt_description?.substring(0, 30) || photo.id
          }.jpg`,
        },
        author: photo.user.name,
        notes: photo.description || undefined,
        default_field_metadata: ctx.site.attributes.locales.reduce(
          (acc, locale) => {
            if (locale.startsWith('en')) {
              return {
                ...acc,
                [locale]: {
                  alt: photo.alt_description,
                  title: null,
                  custom_data: {},
                },
              };
            }

            return {
              ...acc,
              [locale]: { alt: null, title: null, custom_data: {} },
            };
          },
          {},
        ),
      });
    },
    [ctx],
  );

  const performRequest = useCallback(
    async (page: number): Promise<Response> => {
      setLoading(true);

      const request = query
        ? unsplash.search.getPhotos({
            query,
            page,
            perPage: PER_PAGE,
            orientation: orientation === 'all' ? undefined : orientation,
            color: color === 'all' ? undefined : color,
          })
        : unsplash.photos.list({
            page,
            perPage: PER_PAGE,
            orderBy: OrderBy.POPULAR,
          });

      const response = await request;

      if (!response.response) {
        throw new Error();
      }

      setLoading(false);

      return response.response;
    },
    [orientation, color, query, setLoading],
  );

  const handleSearch = useCallback(
    async (e?: FormEvent<HTMLFormElement>) => {
      if (e) {
        e.preventDefault();
      }
      setPage(1);
      setPhotos(await performRequest(1));
    },
    [setPage, setPhotos, performRequest],
  );

  const handleLoadMore = useCallback(async () => {
    setPage((page) => page + 1);
    const result = await performRequest(page + 1);
    setPhotos((oldPhotos) => ({
      results: [...(oldPhotos?.results || []), ...result.results],
      total: result.total,
    }));
    setLoading(false);
  }, [page, setPage, setPhotos, setLoading, performRequest]);

  useEffect(() => {
    async function run() {
      setPhotos(await performRequest(1));
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, color]);

  const rootRef = useRef<HTMLDivElement>(null);
  const rect = useElementLayout(rootRef as React.MutableRefObject<Element>);
  const columns = Math.round(rect.width / 370.0);

  const colsData = useMemo(() => {
    return photos ? chunkArray(photos.results, columns) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, photos && JSON.stringify(photos.results)]);

  return (
    <div ref={rootRef}>
      <form className={s.search} onSubmit={handleSearch}>
        <div className={s.searchFirstRow}>
          <TextInput
            value={query}
            placeholder="Search free high-resolution photos..."
            onChange={(newValue) => setQuery(newValue)}
            className={s.search__input}
          />
          <Button
            type="submit"
            buttonSize="s"
            buttonType="primary"
            leftIcon={<FontAwesomeIcon icon={faSearch} />}
          >
            Search
          </Button>
        </div>
        <div className={s.searchFirstRow}>
          <div className={s.searchFilter}>
            <div className={s.searchFilterLabel}>Orientation</div>
            <SelectInput
              options={orientationOptions}
              value={orientationOptions.find((o) => o.value === orientation)}
              isDisabled={!query}
              onChange={(o) => {
                setOrientation(o?.value || 'all');
              }}
            />
          </div>
          <div className={s.searchFilter}>
            <div className={s.searchFilterLabel}>Orientation</div>
            <SelectInput
              options={colorOptions}
              value={colorOptions.find((o) => o.value === color)}
              isDisabled={!query}
              onChange={(o) => {
                setColor(o?.value || 'all');
              }}
              formatOptionLabel={(option, { context }) => {
                return (
                  <>
                    <div
                      className={classNames(s.colorSample, s[option.value])}
                    />{' '}
                    {option.label}
                  </>
                );
              }}
            />
          </div>
        </div>
      </form>
      <div className={s.container}>
        {loading && <Spinner size={50} placement="centered" />}
        {colsData && photos && (
          <>
            <div
              className={classNames(s.masonry, {
                [s.masonryLoading]: loading,
              })}
              style={
                {
                  '--columns': columns,
                } as CSSProperties
              }
            >
              {colsData.map((group, i) => (
                <div className={s.masonryCol} key={i}>
                  {group.map((photo) => (
                    <Cell
                      key={photo.id}
                      photo={photo}
                      onClick={handleSelect.bind(null, photo)}
                    />
                  ))}
                </div>
              ))}
            </div>
            {photos.total !== photos.results.length && (
              <div className={s.footer}>
                <Button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loading}
                  fullWidth
                >
                  Load more...
                </Button>
              </div>
            )}{' '}
          </>
        )}
      </div>
    </div>
  );
};

export default AssetBrowser;
