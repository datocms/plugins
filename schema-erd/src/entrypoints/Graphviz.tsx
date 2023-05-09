import { RenderPagePropertiesAndMethods } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import s from './styles.module.css';
import {
  allEntities,
  download,
  generateGraph,
  withViz,
} from '../utils/generateGraph';
import {
  promiseAllWithProgress,
  useAsyncEffect,
} from '../utils/useAsyncEffect';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { useRef, useState } from 'react';
import { encode } from 'universal-base64';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { useElementSize } from 'usehooks-ts';
import Queue from 'promise-queue';

const queue = new Queue(50, Infinity);

type Props = {
  ctx: RenderPagePropertiesAndMethods;
};

function toIds(entities: Partial<Record<string, { id: string }>>) {
  return allEntities(entities)
    .map((e) => e.id)
    .join('-');
}

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
  const [pdf, setPdf] = useState<undefined | string>();
  const [size, setSize] = useState<undefined | [number, number]>();

  useAsyncEffect(async () => {
    if (!firstRun.current) {
      return;
    }

    firstRun.current = false;

    const promises = allEntities(ctx.itemTypes).map((itemType) => {
      if (
        itemType.relationships.fields.data.length === 0 ||
        ctx.fields[itemType.relationships.fields.data[0].id]
      ) {
        return Promise.resolve();
      }

      return queue.add(() => ctx.loadItemTypeFields(itemType.id));
    });

    await promiseAllWithProgress(promises, (completed, total) =>
      setLoadingState({ total, completed }),
    );
  }, []);

  useAsyncEffect(async () => {
    if (!loadingState || loadingState.completed !== loadingState.total) {
      return;
    }

    const dot = await generateGraph({
      itemTypes: ctx.itemTypes,
      fields: ctx.fields,
    });

    setDot(dot);
  }, [loadingState, toIds(ctx.itemTypes), toIds(ctx.fields)]);

  useAsyncEffect(async () => {
    if (!dot) {
      return;
    }

    const svg = await withViz(async (viz) => {
      return await viz.renderString(dot);
    });

    setSvg(svg);
  }, [dot]);

  useAsyncEffect(async () => {
    if (!svg) {
      return;
    }

    const element = document.createElement('svg');
    element.innerHTML = svg;

    const svgElement = element.firstElementChild! as HTMLElement &
      SVGRectElement;

    // force layout calculation
    svgElement.getBoundingClientRect();

    const width = svgElement.width.baseVal.value;
    const height = svgElement.height.baseVal.value;

    const pdf = new jsPDF(width > height ? 'l' : 'p', 'pt', [width, height]);

    await pdf.svg(svgElement, { width, height });

    setPdf(pdf.output('datauristring'));
    setSize([width, height]);
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

  async function downloadAsPdf() {
    if (!pdf) {
      return;
    }

    download('schema.pdf', pdf);
  }

  const [setRef, elementSize] = useElementSize();

  const minScale = size
    ? Math.min(elementSize.width / size[0], elementSize.height / size[1])
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
              <Button buttonSize="xs" onClick={downloadAsPdf}>
                .PDF
              </Button>
            </div>
          </div>
        </div>
        <div className={s.wrapper} ref={setRef}>
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
              <Spinner placement='inline' /> Loading models and block models...
              ({loadingState.completed}/{loadingState.total})
            </div>
          )}
        </div>
      </div>
    </Canvas>
  );
}
