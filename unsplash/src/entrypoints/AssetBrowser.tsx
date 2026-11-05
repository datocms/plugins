import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import ButtonTrigger from 'datocms-react-ui/Dropdown/triggers/ButtonTrigger';
import { useDebouncedValue } from 'datocms-react-ui/hooks/useDebouncedValue';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import Search from 'datocms-react-ui/Search';
import StringInput from 'datocms-react-ui/StringInput';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createApi, OrderBy } from 'unsplash-js';
import type { Basic as Photo } from 'unsplash-js/dist/methods/photos/types';
import Cell from '../components/Cell';
import { CircleExclamationIcon, SearchIcon } from '../icons';
import s from './styles.module.css';

const PER_PAGE = 30;

const unsplash = createApi({
  apiUrl: 'https://unsplash-api.datocms.com',
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

  for (const item of array) {
    const minCol = results.reduce<Chunk<T> | null>((winner, col) => {
      return !winner || col.total < winner.total ? col : winner;
    }, null);

    if (!minCol) {
      continue;
    }

    minCol.items.push(item);
    minCol.total += (1.0 * item.height) / item.width;
  }

  return results.map((c) => c.items);
}

const orientationOptions: Array<{ value: Orientation; label: string }> = [
  { value: 'all', label: 'Any' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'squarish', label: 'Square' },
];

const colorOptions: Array<{ value: Color; label: string }> = [
  { value: 'all', label: 'Any' },
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
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 1000);

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
        default_field_metadata: Object.fromEntries(
          ctx.site.attributes.locales.map((locale) => {
            if (locale.startsWith('en')) {
              return [
                locale,
                {
                  alt: photo.alt_description,
                  title: null,
                  custom_data: {
                    unsplash_author_username: photo.user.username,
                    unsplash_photo_id: photo.id,
                  },
                },
              ];
            }

            return [locale, { alt: null, title: null, custom_data: {} }];
          }),
        ),
      });
    },
    [ctx],
  );

  const performRequest = useCallback(
    async (page: number): Promise<Response> => {
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

      return response.response;
    },
    [orientation, color, query],
  );

  const handleSearch = useCallback(
    async (e?: FormEvent<HTMLFormElement>) => {
      if (e) {
        e.preventDefault();
      }
      setPage(1);
      setFailed(false);
      setSearching(true);
      try {
        setPhotos(await performRequest(1));
      } catch {
        // A retry or a new search then shows the loading state, not the
        // photos from before the error
        setPhotos(undefined);
        setFailed(true);
      } finally {
        setSearching(false);
      }
    },
    [performRequest],
  );

  // A failed page keeps the photos on screen, and the next click asks for the
  // same page again
  const handleLoadMore = useCallback(async () => {
    try {
      const result = await performRequest(page + 1);
      setPhotos((oldPhotos) => ({
        results: [...(oldPhotos?.results || []), ...result.results],
        total: result.total,
      }));
      setPage(page + 1);
    } catch {
      ctx.alert('More photos could not be loaded. Try again in a moment.');
    }
  }, [ctx, page, performRequest]);

  // The search runs one second after the last key, and right away when a
  // filter changes; the Search button and Enter run it at once
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleSearch changes on each key
  useEffect(() => {
    handleSearch();
  }, [debouncedQuery, orientation, color]);

  const rootRef = useRef<HTMLDivElement>(null);
  const rect = useElementLayout(rootRef);
  const columns = Math.round(rect.width / 370.0);

  const colsData = useMemo(() => {
    return photos ? chunkArray(photos.results, columns) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, photos]);

  let results: ReactNode;

  if (failed) {
    results = (
      <BlankSlate
        placement="section"
        error
        icon={<CircleExclamationIcon />}
        title="The photos could not be loaded"
        actions={<Button label="Try again" onClick={() => handleSearch()} />}
      />
    );
  } else if (!photos || !colsData) {
    results = <BlankSlate placement="section" loading title="Loading photos" />;
  } else if (photos.results.length === 0) {
    results = (
      <BlankSlate
        placement="section"
        icon={<SearchIcon />}
        title={
          orientation !== 'all' || color !== 'all'
            ? 'No photos match this search and filters'
            : 'No photos match this search'
        }
      />
    );
  } else {
    results = (
      <div
        className={s.masonry}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {colsData.map((group, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position
          <div key={index} className={s.column}>
            {group.map((photo) => (
              <Cell
                key={photo.id}
                photo={photo}
                onClick={() => handleSelect(photo)}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={s.browser}>
      <Search ariaLabel="Unsplash photos">
        <form className={s.search} onSubmit={handleSearch}>
          <StringInput
            className={s.query}
            aria-label="Search photos"
            placeholder="Search free photos on Unsplash"
            value={query}
            onChange={(next) => {
              setQuery(next ?? '');
              // The popular photos take no filters
              if (!next) {
                setOrientation('all');
                setColor('all');
              }
            }}
          />
          <Dropdown
            triggerComponent={ButtonTrigger}
            tone="ghost"
            size="field"
            label={`Orientation: ${
              orientationOptions.find((option) => option.value === orientation)
                ?.label
            }`}
            disabled={
              query
                ? undefined
                : { reason: 'Type a search to filter by orientation.' }
            }
          >
            <Dropdown.Menu>
              {orientationOptions.map((option) => (
                <Dropdown.Option
                  key={option.value}
                  active={option.value === orientation}
                  onPick={() => setOrientation(option.value)}
                >
                  {option.label}
                </Dropdown.Option>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Dropdown
            triggerComponent={ButtonTrigger}
            tone="ghost"
            size="field"
            label={`Color: ${
              colorOptions.find((option) => option.value === color)?.label
            }`}
            disabled={
              query
                ? undefined
                : { reason: 'Type a search to filter by color.' }
            }
          >
            <Dropdown.Menu contextualSearch={false}>
              {colorOptions.map((option) => (
                <Dropdown.Option
                  key={option.value}
                  active={option.value === color}
                  onPick={() => setColor(option.value)}
                >
                  {option.label}
                </Dropdown.Option>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Button
            submit
            tone="primary"
            size="field"
            icon={SearchIcon}
            label="Search"
            busy={searching && photos !== undefined}
          />
        </form>
      </Search>
      {results}
      {photos && !failed && photos.total !== photos.results.length && (
        <Button
          className={s.loadMore}
          label="Load more"
          disabled={
            searching ? { reason: 'Wait for the search to finish.' } : undefined
          }
          onClick={handleLoadMore}
        />
      )}
    </div>
  );
};

export default AssetBrowser;
