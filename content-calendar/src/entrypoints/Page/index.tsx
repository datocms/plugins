import { buildClient, type SchemaTypes } from '@datocms/cma-client';
import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isThisMonth,
  startOfMonth,
  subMonths,
} from 'date-fns';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import { Dropdown } from 'datocms-react-ui/Dropdown';
import { useDidUpdateEffect } from 'datocms-react-ui/hooks/useDidUpdateEffect';
import { useIsSmallViewport } from 'datocms-react-ui/hooks/useMediaQuery';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import SplitPane from 'datocms-react-ui/SplitPane';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActiveModelsPanel } from '../../components/ActiveModelsPanel';
import CalendarGrid from '../../components/CalendarGrid';
import { HoverItemContext } from '../../context/HoverItemContext';
import { useStickyState } from '../../hooks/useStickyState';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleExclamationIcon,
  RefreshIcon,
} from '../../icons';
import {
  type ActiveModels,
  allCriteria,
  type Criteria,
  criteriaLabel,
  criteriaTriggerLabel,
  isActiveModels,
  isCriteria,
} from '../../types';
import { generateMatrix } from '../../utils/calendar';
import { weekStartLocale } from '../../utils/getWeekStart';
import s from './styles.module.css';

const PAGE_LIMIT = 500;

/** The last response: the calendar keeps it while the next one loads */
type LoadedRecords = {
  items: SchemaTypes.Item[];
  totalCount: number;
  /** The date that placed the records on the calendar */
  criteria: Criteria;
  /** What the request asked for (see `requestKey`) */
  request: string;
};

/** The days, the date and the models of a request of the records */
function requestKey(
  firstDay: Date,
  lastDay: Date,
  criteria: Criteria,
  activeModelIds: string | undefined,
) {
  return [
    firstDay.toISOString(),
    lastDay.toISOString(),
    criteria,
    activeModelIds ?? 'all',
  ].join('|');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The loaded records that are on a day of the month (not of the weeks
 * around it), placed as the grid places them */
function countMonthRecords(loaded: LoadedRecords | null, month: Date) {
  if (loaded === null) {
    return 0;
  }

  let count = 0;

  for (const item of loaded.items) {
    const value = item.meta[loaded.criteria];

    if (typeof value === 'string' && isSameMonth(new Date(value), month)) {
      count += 1;
    }
  }

  return count;
}

function formatRecordCount(numberFormat: Intl.NumberFormat, count: number) {
  if (count === 0) {
    return 'No records';
  }

  if (count === 1) {
    return '1 record';
  }

  return `${numberFormat.format(count)} records`;
}

type CalendarAreaProps = {
  month: Date;
  criteria: Criteria;
  matrix: Date[][];
  noModelShown: boolean;
  isLoading: boolean;
  error: string | null;
  loaded: LoadedRecords | null;
  /** The current request has more records than the page of the response */
  isTruncated: boolean;
  numberFormat: Intl.NumberFormat;
  onShowAllModels: () => void;
  onRetry: () => void;
};

/** The content of the calendar pane, in each of its states */
function CalendarArea({
  month,
  criteria,
  matrix,
  noModelShown,
  isLoading,
  error,
  loaded,
  isTruncated,
  numberFormat,
  onShowAllModels,
  onRetry,
}: CalendarAreaProps) {
  if (noModelShown) {
    return (
      <BlankSlate
        placement="area"
        icon={<CalendarIcon />}
        title="No models shown"
        description="Turn on a model in the list to see its records in the calendar."
        actions={<Button label="Show all models" onClick={onShowAllModels} />}
      />
    );
  }

  if (error !== null && isLoading) {
    // "Try again", or another month, date or set of models, after an
    // error: the area tells that the records load
    return <BlankSlate placement="area" loading title="Loading the records" />;
  }

  if (error !== null) {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="The records didn't load"
        code={error}
        description="Check your connection, then try again."
        actions={
          <Button icon={RefreshIcon} label="Try again" onClick={onRetry} />
        }
      />
    );
  }

  return (
    <div className={s.content}>
      {isTruncated && loaded !== null && (
        <Callout
          tone="warning"
          title="Some records are not shown"
          className={s.callout}
        >
          The calendar shows the first{' '}
          {numberFormat.format(loaded.items.length)} of{' '}
          {numberFormat.format(loaded.totalCount)} records. Show fewer models to
          see the others.
        </Callout>
      )}
      <CalendarGrid
        month={month}
        criteria={loaded?.criteria ?? criteria}
        items={loaded?.items ?? []}
        matrix={matrix}
      />
    </div>
  );
}

export default function Page() {
  const ctx = useCtx<RenderPageCtx>();
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [hoverModelId, setHoverModelId] = useState<string | null>(null);

  const [activeModels, setActiveModels] = useStickyState<ActiveModels>(
    'all',
    `contentCalendarPlugin.${ctx.site.id}.${ctx.environment}.activeModelIds`,
    isActiveModels,
  );
  const [criteria, setCriteria] = useStickyState<Criteria>(
    'created_at',
    `contentCalendarPlugin.${ctx.site.id}.${ctx.environment}.criteria`,
    isCriteria,
  );

  // In a frame of 1024px or less, the calendar needs the whole width: the
  // list of models shows over it, from the rail, and starts closed (an open
  // list covers the calendar until a click out of it). A wider frame puts
  // the list beside the calendar, open.
  const isSmallViewport = useIsSmallViewport();
  const [modelsWidth, setModelsWidth] = useState(300);
  const [modelsOpen, setModelsOpen] = useState(() => !isSmallViewport);

  // When the frame crosses the breakpoint, the list takes the first state of
  // the new width
  useDidUpdateEffect(() => {
    setModelsOpen(!isSmallViewport);
  }, [isSmallViewport]);

  const [loaded, setLoaded] = useState<LoadedRecords | null>(null);
  // Before the first load ends, the empty calendar does not mean "no records"
  const [isLoading, setIsLoading] = useState(
    () => activeModels === 'all' || activeModels.length > 0,
  );
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const weekStartsOn = weekStartLocale(ctx.ui.locale);

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(ctx.ui.locale),
    [ctx.ui.locale],
  );

  const handlePrev = useCallback(() => {
    setMonth((d) => subMonths(d, 1));
  }, []);

  const handleNext = useCallback(() => {
    setMonth((d) => addMonths(d, 1));
  }, []);

  const handleCurr = useCallback(() => {
    setMonth(startOfMonth(new Date()));
  }, []);

  const retry = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  const client = useMemo(() => {
    const apiToken = ctx.currentUserAccessToken;
    if (!apiToken) {
      throw new Error('No access token available');
    }
    return buildClient({
      apiToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);

  const matrix = useMemo(
    () =>
      generateMatrix({
        year: month.getFullYear(),
        month: month.getMonth(),
        weekStartsOn,
      }),
    [month, weekStartsOn],
  );

  const firstDay = matrix[0][0];
  const lastDay =
    matrix[matrix.length - 1][matrix[matrix.length - 1].length - 1];

  const activeModelIds =
    activeModels === 'all' ? undefined : activeModels.join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadCount` re-runs the request when the user clicks "Try again".
  useEffect(() => {
    // No model is shown: nothing to load. The last records stay, thus when
    // a model shows again the calendar loads as on any other change, with
    // the spinner in the toolbar.
    if (activeModelIds === '') {
      setError(null);
      setIsLoading(false);
      return;
    }

    // The last records stay while the new ones load. After an error, the
    // pane tells that the records load again (see below).
    setIsLoading(true);
    const request = requestKey(firstDay, lastDay, criteria, activeModelIds);

    // A newer run (another month, date or set of models) ignores the
    // response of this one
    let ignore = false;

    async function run() {
      try {
        const { data: items, meta } = await client.items.rawList({
          version: 'current',
          filter: {
            type: activeModelIds,
            fields: {
              [`_${criteria}`]: {
                gt: firstDay.toISOString(),
                lt: addDays(lastDay, 1).toISOString(),
              },
            },
          },
          page: {
            limit: PAGE_LIMIT,
          },
        });

        if (ignore) {
          return;
        }

        setLoaded({ items, totalCount: meta.total_count, criteria, request });
        setError(null);
      } catch (e) {
        if (ignore) {
          return;
        }

        setLoaded(null);
        setError(errorMessage(e));
      }

      setIsLoading(false);
    }

    run();

    return () => {
      ignore = true;
    };
  }, [firstDay, lastDay, client, criteria, activeModelIds, reloadCount]);

  const hoverContext = useMemo(
    () => ({ modelId: hoverModelId, setModelId: setHoverModelId }),
    [hoverModelId],
  );

  const noModelShown = activeModelIds === '';

  // The count and the warning tell about the records of the current
  // request: while another month, date or set of models loads, they do not
  // show the ones of the previous request (the last grid stays, with the
  // spinner in the toolbar)
  const loadedIsCurrent =
    !isLoading &&
    loaded !== null &&
    loaded.request === requestKey(firstDay, lastDay, criteria, activeModelIds);
  const isTruncated =
    loadedIsCurrent &&
    loaded !== null &&
    loaded.totalCount > loaded.items.length;
  // The count is the one of the month in the title: the records on the days
  // of the weeks around it are not in it. When the response has only a part
  // of the records, the count of the month is not known: the callout tells
  // the numbers instead.
  const recordCount = formatRecordCount(
    numberFormat,
    countMonthRecords(loaded, month),
  );

  // The spinner covers the pane only before the first load: then the last
  // grid stays, and the toolbar stays usable while the next records load.
  // After an error, the area itself tells that the records load again.
  const isFirstLoad = isLoading && loaded === null && error === null;
  const isReload = isLoading && loaded !== null && error === null;

  const showAllModels = useCallback(() => {
    setActiveModels('all');
  }, [setActiveModels]);

  return (
    <div className={s.layout}>
      <HoverItemContext.Provider value={hoverContext}>
        <SplitPane
          primaryPane="right"
          mode={isSmallViewport ? 'overlay' : 'split'}
          size={modelsWidth}
          onDragFinished={setModelsWidth}
          minSize={220}
          maxSize="50%"
          collapse={{ open: modelsOpen, onToggle: setModelsOpen }}
        >
          <ActiveModelsPanel
            activeModels={activeModels}
            onChange={setActiveModels}
          />
          <Main>
            <Pane
              ariaLabel="Calendar"
              busy={isFirstLoad}
              header={
                <Toolbar>
                  <Toolbar.Title
                    level={1}
                    help={
                      <Toolbar.Help>
                        Shows each record on the day of the date you pick. Click
                        a record to open it.
                      </Toolbar.Help>
                    }
                  >
                    <span className="visually-hidden">Calendar, </span>
                    {format(month, 'LLLL yyyy')}
                  </Toolbar.Title>
                  <Toolbar.Subtitle hidden={!loadedIsCurrent || isTruncated}>
                    {recordCount}
                  </Toolbar.Subtitle>
                  <Toolbar.TextualDropdown
                    text={criteriaTriggerLabel[criteria]}
                  >
                    {allCriteria.map((c) => (
                      <Dropdown.Option
                        key={c}
                        active={c === criteria}
                        onPick={() => setCriteria(c)}
                      >
                        {criteriaLabel[c]}
                      </Dropdown.Option>
                    ))}
                  </Toolbar.TextualDropdown>
                  <Toolbar.Spinner show={isReload} />
                  <Toolbar.Space />
                  <Toolbar.Group>
                    <Toolbar.Button
                      iconOnly
                      icon={ChevronLeftIcon}
                      label="Previous month"
                      onClick={handlePrev}
                    />
                    <Toolbar.Button
                      label="Today"
                      onClick={handleCurr}
                      disabled={
                        isThisMonth(month)
                          ? {
                              reason:
                                'The calendar already shows the current month.',
                            }
                          : undefined
                      }
                    />
                    <Toolbar.Button
                      iconOnly
                      icon={ChevronRightIcon}
                      label="Next month"
                      onClick={handleNext}
                    />
                  </Toolbar.Group>
                </Toolbar>
              }
            >
              <CalendarArea
                month={month}
                criteria={criteria}
                matrix={matrix}
                noModelShown={noModelShown}
                isLoading={isLoading}
                error={error}
                loaded={loaded}
                isTruncated={isTruncated}
                numberFormat={numberFormat}
                onShowAllModels={showAllModels}
                onRetry={retry}
              />
            </Pane>
          </Main>
        </SplitPane>
      </HoverItemContext.Provider>
    </div>
  );
}
