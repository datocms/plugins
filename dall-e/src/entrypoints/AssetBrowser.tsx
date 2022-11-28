import { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import {
  Button,
  SelectInput,
  Spinner,
  TextInput,
  useCtx,
  useElementLayout,
} from 'datocms-react-ui';
import classNames from 'classnames';
import React, {
  CSSProperties,
  FormEvent,
  useCallback,
  useRef,
  useState,
} from 'react';
import s from './styles.module.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { Configuration, ImagesResponse, OpenAIApi } from 'openai';
import Cell from '../components/Cell';

type Image = ImagesResponse['data'][0];
type Size = '256x256' | '512x512' | '1024x1024';

const sizeOptions = [
  { value: '256x256', label: '256x256 px' },
  { value: '512x512', label: '512x512 px' },
  { value: '1024x1024', label: '1024x1024 px' },
];

const nOptions = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
];

const AssetBrowser = () => {
  const ctx = useCtx<RenderAssetSourceCtx>();
  const [prompt, setPrompt] = useState('');
  const [imageRequests, setImageRequests] = useState<
    { images: Image[]; prompt: string; size: number }[]
  >([]);
  const [n, setN] = useState<number>(1);
  const [size, setSize] = useState<Size>('512x512');
  const [loading, setLoading] = useState(false);

  const handleSelect = useCallback(
    async (image: Image) => {
      ctx.select({
        resource: {
          base64: `data:image/png;base64,${image.b64_json}`,
          filename: `${prompt.substring(0, 30)}.png`,
        },
        notes: `Generated via DALL-E using prompt: "${prompt}"`,
        tags: ['dall-e'],
        default_field_metadata: ctx.site.attributes.locales.reduce(
          (acc, locale) => {
            if (locale.startsWith('en')) {
              return {
                ...acc,
                [locale]: {
                  alt: prompt,
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
    [prompt, ctx],
  );

  const performRequest = useCallback(async (): Promise<{
    images: Image[];
    prompt: string;
    size: number;
  }> => {
    setLoading(true);

    const { apiKey } = ctx.plugin.attributes.parameters;

    if (!apiKey) {
      ctx.alert('Please provide a valid OpenAI API key in plugin settings!');
    }

    const client = new OpenAIApi(
      new Configuration({
        apiKey: ctx.plugin.attributes.parameters.apiKey as string,
      }),
    );

    const response = await client.createImage({
      prompt,
      n,
      size,
      response_format: 'b64_json',
    });

    setLoading(false);

    return {
      images: response.data.data,
      prompt,
      size: parseInt(size.split('x')[0]),
    };
  }, [size, n, prompt, setLoading, ctx]);

  const handleSearch = useCallback(
    async (e?: FormEvent<HTMLFormElement>) => {
      if (e) {
        e.preventDefault();
      }
      try {
        const newImages = await performRequest();
        setImageRequests((images) => [newImages, ...images]);
      } catch (e) {
        ctx.alert('Something went wrong!');
        console.error('DALL-E plugin', e);
      }
    },
    [setImageRequests, performRequest, ctx],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const rect = useElementLayout(rootRef as React.MutableRefObject<Element>);

  return (
    <div ref={rootRef}>
      <form className={s.search} onSubmit={handleSearch}>
        <div className={s.searchFirstRow}>
          <TextInput
            value={prompt}
            placeholder={`Start with a detailed description, like "High quality photo of a monkey astronaut..."`}
            onChange={(newValue) => setPrompt(newValue)}
            className={s.search__input}
          />
          <Button
            type="submit"
            buttonSize="s"
            buttonType="primary"
            disabled={loading}
            leftIcon={<FontAwesomeIcon icon={faSearch} />}
          >
            Generate
          </Button>
        </div>
        <div className={s.searchFirstRow}>
          <div className={s.searchFilter}>
            <div className={s.searchFilterLabel}>Image size</div>
            <SelectInput
              options={sizeOptions}
              value={sizeOptions.find((o) => o.value === size)}
              isClearable={false}
              onChange={(o) => {
                setSize((o?.value as Size) || '512x512');
              }}
            />
          </div>
          <div className={s.searchFilter}>
            <div className={s.searchFilterLabel}>
              Number of variants to generate
            </div>
            <SelectInput
              options={nOptions}
              value={nOptions.find((o) => o.value === n)}
              onChange={(o) => {
                setN(o?.value || 1);
              }}
            />
          </div>
        </div>
      </form>
      <div className={s.container}>
        {loading && <Spinner size={50} placement="centered" />}
        {imageRequests.map((imageRequest) => (
          <div className={s.imageRequest} key={imageRequest.prompt}>
            <div className={s.imageRequestPrompt}>"{imageRequest.prompt}"</div>
            <div
              className={classNames(s.imageRequestMasonry, {
                [s.imageRequestMasonryLoading]: loading,
              })}
              style={
                {
                  '--columns': Math.round(
                    rect.width / Math.min(512, imageRequest.size),
                  ),
                } as CSSProperties
              }
            >
              {imageRequest.images.map((image) => (
                <Cell
                  key={image.url}
                  image={image}
                  onClick={handleSelect.bind(null, image)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AssetBrowser;
