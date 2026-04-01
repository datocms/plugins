import { Scheduler } from 'async-scheduler';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ReactZoomPanPinchContentRef,
  TransformComponent,
  TransformWrapper,
} from 'react-zoom-pan-pinch';
import { encode } from 'universal-base64';
import {
  allEntities,
  download,
  generateGraph,
  withViz,
} from '../utils/generateGraph';
import { promiseAllWithProgress } from '../utils/useAsyncEffect';
import s from './styles.module.css';

const queue = new Scheduler(10);

type Props = {
  ctx: RenderPageCtx;
};

const Controls: React.FC<ReactZoomPanPinchContentRef> = ({
  zoomIn,
  zoomOut,
  resetTransform,
  centerView,
}: ReactZoomPanPinchContentRef) => (
  <div className={s.controlPanel}>
    <button type="button" className={s.controlBtn} onClick={() => zoomIn()}>
      Zoom In +
    </button>
    <button type="button" className={s.controlBtn} onClick={() => zoomOut()}>
      Zoom Out -
    </button>
    <button
      type="button"
      className={s.controlBtn}
      onClick={() => resetTransform()}
    >
      Reset
    </button>
    <button type="button" className={s.controlBtn} onClick={() => centerView()}>
      Center
    </button>
  </div>
);

export default function Graphviz({ ctx }: Props) {
  const firstRun = useRef(true);
  const [loadingState, setLoadingState] = useState<
    | {
        total: number;
        completed: number;
      }
    | undefined
  >();
  const [dot, setDot] = useState<undefined | string>();
  const [svg, setSvg] = useState<undefined | string>();
  const [size, setSize] = useState<undefined | [number, number]>();
  const [containerElement, setContainerElement] =
    useState<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // A stable re-throw mechanism so errors bubble to the React error boundary
  const [, setErrorState] = useState<boolean>();
  const throwAsync = useCallback((error: unknown) => {
    setErrorState(() => {
      throw error;
    });
  }, []);

  useEffect(() => {
    if (!firstRun.current) {
      return;
    }

    firstRun.current = false;

    async function loadFields() {
      const promises = allEntities(ctx.itemTypes).map((itemType) => {
        if (
          itemType.relationships.fields.data.length === 0 ||
          ctx.fields[itemType.relationships.fields.data[0].id]
        ) {
          return Promise.resolve();
        }

        return queue.enqueue(() => ctx.loadItemTypeFields(itemType.id));
      });

      await promiseAllWithProgress(promises, (completed, total) =>
        setLoadingState({ total, completed }),
      );
    }

    loadFields().catch(throwAsync);
  }, [ctx.itemTypes, ctx.fields, ctx.loadItemTypeFields, throwAsync]);

  useEffect(() => {
    if (!loadingState || loadingState.completed !== loadingState.total) {
      return;
    }

    async function buildGraph() {
      const generatedDot = await generateGraph({
        itemTypes: ctx.itemTypes,
        fields: ctx.fields,
      });

      setDot(generatedDot);
    }

    buildGraph().catch(throwAsync);
  }, [loadingState, ctx.itemTypes, ctx.fields, throwAsync]);

  useEffect(() => {
    if (!dot) {
      return;
    }

    async function renderSvg() {
      const renderedSvg = await withViz(async (viz) => {
        return await viz.renderString(dot as string);
      });

      setSvg(renderedSvg);
    }

    renderSvg().catch(throwAsync);
  }, [dot, throwAsync]);

  useEffect(() => {
    if (!svg) {
      return;
    }

    async function measureSvg() {
      const element = document.createElement('svg');
      element.innerHTML = svg as string;

      const rawFirstChild = element.firstElementChild;
      if (!rawFirstChild) {
        return;
      }

      const svgElement = rawFirstChild as HTMLElement & SVGRectElement;

      // force layout calculation
      svgElement.getBoundingClientRect();

      const width = svgElement.width.baseVal.value;
      const height = svgElement.height.baseVal.value;

      setSize([width, height]);
    }

    measureSvg().catch(throwAsync);
  }, [svg, throwAsync]);

  async function downloadAsDotLanguage() {
    if (!dot) {
      return;
    }

    download(
      'schema.dot',
      `data:text/plain;charset=utf-8,${encodeURIComponent(dot)}`,
    );
  }

  async function downloadAsSvg() {
    if (!svg) {
      return;
    }

    download('schema.svg', `data:image/svg+xml;base64,${encode(svg)}`);
  }

  useEffect(() => {
    if (!containerElement) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const rect = containerElement.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    });

    observer.observe(containerElement);

    const rect = containerElement.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });

    return () => observer.disconnect();
  }, [containerElement]);

  const minScale =
    size && containerSize.width && containerSize.height
      ? Math.min(containerSize.width / size[0], containerSize.height / size[1])
      : undefined;

  return (
    <Canvas ctx={ctx}>
      <div className={s.root}>
        <div className={s.topBar}>
          <div className={s.title}>Schema ERD generator</div>
          <div className={s.actions}>
            Download schema as
            <div className={s.buttons}>
              <Button buttonSize="xs" onClick={downloadAsDotLanguage}>
                GraphViz .DOT
              </Button>{' '}
              <Button buttonSize="xs" onClick={downloadAsSvg}>
                .SVG
              </Button>{' '}
            </div>
          </div>
        </div>
        <div className={s.wrapper} ref={setContainerElement}>
          {svg && minScale && (
            <TransformWrapper
              initialScale={minScale}
              minScale={minScale * 0.7}
              centerOnInit={true}
              wheel={{ step: 0.04 }}
            >
              {(utils) => (
                <div>
                  <Controls {...utils} />
                  <TransformComponent
                    wrapperStyle={{
                      width: '100%',
                      height: 'calc(100vh - 60px)',
                      maxWidth: '100%',
                      maxHeight: 'calc(100vh - 60px)',
                    }}
                  >
                    <img
                      src={`data:image/svg+xml;base64,${encode(svg)}`}
                      alt="Schema"
                    />
                  </TransformComponent>
                </div>
              )}
            </TransformWrapper>
          )}
          {loadingState && loadingState.completed < loadingState.total && (
            <div className={s.progress}>
              <Spinner placement="inline" /> Loading models and block models...
              ({loadingState.completed}/{loadingState.total})
            </div>
          )}
        </div>
      </div>
    </Canvas>
  );
}
