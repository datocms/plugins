import { Scheduler } from 'async-scheduler';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Canvas from 'datocms-react-ui/Canvas';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useEffect, useRef, useState } from 'react';
import {
  type ReactZoomPanPinchContentRef,
  TransformComponent,
  TransformWrapper,
} from 'react-zoom-pan-pinch';
import { encode } from 'universal-base64';
import {
  ArrowRotateLeftIcon,
  CircleExclamationIcon,
  CrosshairsIcon,
  DiagramIcon,
  DownloadIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from '../icons';
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
  const [error, setError] = useState<unknown>();
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementLayout(containerRef);
  const zoomRef = useRef<ReactZoomPanPinchContentRef>(null);
  const clusterBorderColor = ctx.cssDesignTokens['--color--border'];

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

    loadFields().catch(setError);
  }, [ctx.itemTypes, ctx.fields, ctx.loadItemTypeFields]);

  useEffect(() => {
    if (!loadingState || loadingState.completed !== loadingState.total) {
      return;
    }

    async function buildGraph() {
      const generatedDot = await generateGraph({
        itemTypes: ctx.itemTypes,
        fields: ctx.fields,
        colorScheme: ctx.colorScheme,
        clusterBorderColor,
      });

      setDot(generatedDot);
    }

    buildGraph().catch(setError);
  }, [
    loadingState,
    ctx.itemTypes,
    ctx.fields,
    ctx.colorScheme,
    clusterBorderColor,
  ]);

  useEffect(() => {
    if (!dot) {
      return;
    }

    async function renderSvg() {
      const renderedSvg = await withViz(async (viz) => {
        return viz.renderString(dot as string, { format: 'svg' });
      });

      setSvg(renderedSvg);
    }

    renderSvg().catch(setError);
  }, [dot]);

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

    measureSvg().catch(setError);
  }, [svg]);

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

  const minScale =
    size && width && height
      ? Math.min(width / size[0], height / size[1])
      : undefined;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const progress =
    loadingState &&
    `${loadingState.completed} of ${loadingState.total} models and block models loaded`;
  const isEmpty = allEntities(ctx.itemTypes).length === 0;
  const ready = !error && !isEmpty && Boolean(svg && minScale);

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <Main className={s.page}>
        <Pane
          header={
            <Toolbar>
              <Toolbar.Title
                level={1}
                help={
                  <Toolbar.Help>
                    A diagram of the models and block models of the project,
                    with the link fields between them. Drag to move it, and
                    scroll to zoom.
                  </Toolbar.Help>
                }
              >
                Schema ERD
              </Toolbar.Title>
              <Toolbar.Space />
              {ready && (
                <Toolbar.Group>
                  <Toolbar.Button
                    iconOnly
                    icon={MagnifyingGlassPlusIcon}
                    label="Zoom in"
                    onClick={() => zoomRef.current?.zoomIn()}
                  />
                  <Toolbar.Button
                    iconOnly
                    icon={MagnifyingGlassMinusIcon}
                    label="Zoom out"
                    onClick={() => zoomRef.current?.zoomOut()}
                  />
                  <Toolbar.Button
                    iconOnly
                    icon={ArrowRotateLeftIcon}
                    label="Reset zoom"
                    onClick={() => zoomRef.current?.resetTransform()}
                  />
                  <Toolbar.Button
                    iconOnly
                    icon={CrosshairsIcon}
                    label="Center the diagram"
                    onClick={() => zoomRef.current?.centerView()}
                  />
                </Toolbar.Group>
              )}
              {ready && (
                <Toolbar.PrimaryButton
                  actions={[
                    {
                      label: 'Download SVG',
                      icon: DownloadIcon,
                      onPick: downloadAsSvg,
                    },
                    {
                      label: 'Download Graphviz DOT',
                      onPick: downloadAsDotLanguage,
                    },
                  ]}
                />
              )}
            </Toolbar>
          }
        >
          <div ref={containerRef} className={s.diagram}>
            {error ? (
              <BlankSlate
                placement="area"
                error
                icon={<CircleExclamationIcon />}
                title="The diagram failed to load"
                code={errorMessage}
                description="Reload the page to try again."
              />
            ) : isEmpty ? (
              <BlankSlate
                placement="area"
                icon={<DiagramIcon />}
                title="No models yet"
                description="The models and block models of the schema show here, with the links between them."
              />
            ) : svg && minScale ? (
              <TransformWrapper
                ref={zoomRef}
                initialScale={minScale}
                minScale={minScale * 0.7}
                centerOnInit
                wheel={{ step: 0.04 }}
              >
                <TransformComponent
                  wrapperStyle={{
                    width: '100%',
                    height: '100%',
                    cursor: 'move',
                    background: 'var(--color--surface-muted)',
                  }}
                >
                  <img
                    src={`data:image/svg+xml;base64,${encode(svg)}`}
                    alt="Schema"
                  />
                </TransformComponent>
              </TransformWrapper>
            ) : (
              <BlankSlate
                placement="area"
                loading
                title="Loading the diagram"
                caption={progress}
              />
            )}
          </div>
        </Pane>
      </Main>
    </Canvas>
  );
}
