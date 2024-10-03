import { useCallback, useMemo, useState, useEffect } from 'react';
import { generateMatrix } from '../../utils/calendar';
import {
  format,
  addMonths,
  startOfMonth,
  subMonths,
  isThisMonth,
  addDays,
} from 'date-fns';
import s from './styles.module.css';
import {
  Canvas,
  Toolbar,
  ToolbarButton,
  SidebarLeftArrowIcon,
  SidebarRightArrowIcon,
  ToolbarStack,
  ToolbarTitle,
  ButtonGroup,
  ButtonGroupButton,
  SidebarPanel,
  Dropdown,
  DropdownOption,
  DropdownMenu,
  CaretUpIcon,
  CaretDownIcon,
} from 'datocms-react-ui';
import CalendarGrid from '../../components/CalendarGrid';
import {
  type ActiveModels,
  allCriteria,
  type Criteria,
  criteriaLabel,
} from '../../types';
import { ActiveModelsPanel } from '../../components/ActiveModelsPanel';
import { HoverItemContext } from '../../context/HoverItemContext';
import { weekStartLocale } from '../../utils/getWeekStart';
import { useStickyState } from '../../hooks/useStickyState';
import { buildClient, type SchemaTypes } from '@datocms/cma-client';
import type { RenderPagePropertiesAndMethods } from 'datocms-plugin-sdk';

type PropTypes = {
  ctx: RenderPagePropertiesAndMethods;
};

export default function Page({ ctx }: PropTypes) {
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [hoverModelId, setHoverModelId] = useState<string | null>(null);

  const [activeModels, setActiveModels] = useStickyState<ActiveModels>(
    'all',
    `contentCalendarPlugin.${ctx.site.id}.${ctx.environment}.activeModelIds`,
  );
  const [criteria, setCriteria] = useStickyState<Criteria>(
    'created_at',
    `contentCalendarPlugin.${ctx.site.id}.${ctx.environment}.criteria`,
  );

  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [items, setItems] = useState<SchemaTypes.Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const weekStartsOn = weekStartLocale(ctx.ui.locale);

  const handlePrev = useCallback(() => {
    setMonth((d) => subMonths(d, 1));
  }, []);

  const handleNext = useCallback(() => {
    setMonth((d) => addMonths(d, 1));
  }, []);

  const handleCurr = useCallback(() => {
    setMonth(startOfMonth(new Date()));
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((x) => !x);
  }, []);

  const client = useMemo(
    () =>
      buildClient({
        apiToken: ctx.currentUserAccessToken!,
        environment: ctx.environment,
      }),
    [ctx.currentUserAccessToken, ctx.environment],
  );

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

  useEffect(() => {
    async function run() {
      setIsLoading(true);
      setItems([]);

      if (activeModelIds !== '') {
        const { data: items } = await client.items.rawList({
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
            limit: 500,
          },
        });

        setItems(items);
      }

      setIsLoading(false);
    }
    run();
  }, [firstDay, lastDay, client, criteria, activeModelIds]);

  return (
    <Canvas ctx={ctx}>
      <HoverItemContext.Provider
        value={{ modelId: hoverModelId, setModelId: setHoverModelId }}
      >
        <div className={s.layout}>
          {isSidebarOpen && (
            <div className={s.layoutSidebar}>
              <Toolbar>
                <ToolbarStack />
                <ToolbarButton onClick={handleToggleSidebar}>
                  <SidebarLeftArrowIcon />
                </ToolbarButton>
              </Toolbar>
              <SidebarPanel title="Models" startOpen noPadding>
                <ActiveModelsPanel
                  activeModels={activeModels}
                  onChange={(newActiveModels) => {
                    setActiveModels(newActiveModels);
                  }}
                />
              </SidebarPanel>
            </div>
          )}
          <div className={s.layoutMain}>
            <Toolbar>
              {!isSidebarOpen && (
                <ToolbarButton onClick={handleToggleSidebar}>
                  <SidebarRightArrowIcon />
                </ToolbarButton>
              )}
              <ToolbarStack stackSize="l">
                <ToolbarTitle>{format(month, 'LLLL yyyy')}</ToolbarTitle>
                <div style={{ flex: '1' }} />
                <Dropdown
                  renderTrigger={({ open, onClick }) => (
                    <button
                      type="button"
                      onClick={onClick}
                      className={s.filter}
                    >
                      Show records by:{' '}
                      <strong>{criteriaLabel[criteria]}</strong>{' '}
                      {open ? <CaretUpIcon /> : <CaretDownIcon />}
                    </button>
                  )}
                >
                  <DropdownMenu>
                    {allCriteria.map((c) => (
                      <DropdownOption
                        active={criteria === c}
                        key={c}
                        onClick={() => {
                          setCriteria(c);
                        }}
                      >
                        {criteriaLabel[c]}
                      </DropdownOption>
                    ))}
                  </DropdownMenu>
                </Dropdown>
                <ButtonGroup>
                  <ButtonGroupButton onClick={handlePrev}>
                    Prev month
                  </ButtonGroupButton>
                  <ButtonGroupButton
                    onClick={handleCurr}
                    selected={isThisMonth(month)}
                  >
                    Today
                  </ButtonGroupButton>
                  <ButtonGroupButton onClick={handleNext}>
                    Next month
                  </ButtonGroupButton>
                </ButtonGroup>
              </ToolbarStack>
            </Toolbar>
            <div className={s.layoutCal}>
              <CalendarGrid
                month={month}
                criteria={criteria}
                isLoading={isLoading}
                items={items}
                matrix={matrix}
              />
            </div>
          </div>
        </div>
      </HoverItemContext.Provider>
    </Canvas>
  );
}
