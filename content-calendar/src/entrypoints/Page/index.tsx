import { RenderPagePropertiesAndMethods } from 'datocms-plugin-sdk';
import { useCallback, useState } from 'react';
import {
  format,
  addMonths,
  startOfMonth,
  subMonths,
  isThisMonth,
} from 'date-fns';
import s from './styles.module.css';
import { DatoContext } from '../../utils/useDatoContext';
import {
  Canvas,
  Toolbar,
  ToolbarButton,
  ToolbarSidebarLeftArrowIcon,
  ToolbarSidebarRightArrowIcon,
  ToolbarStack,
  ToolbarTitle,
  ButtonGroup,
  ButtonGroupButton,
  SidebarPanel,
} from 'datocms-react-ui';
import CalendarGrid from '../../components/CalendarGrid';

type PropTypes = {
  ctx: RenderPagePropertiesAndMethods;
};

export default function Page({ ctx }: PropTypes) {
  const [date, setDate] = useState<Date>(startOfMonth(new Date()));
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const handlePrev = useCallback(() => {
    setDate((d) => subMonths(d, 1));
  }, [setDate]);

  const handleNext = useCallback(() => {
    setDate((d) => addMonths(d, 1));
  }, [setDate]);

  const handleCurr = useCallback(() => {
    setDate(startOfMonth(new Date()));
  }, [setDate]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((x) => !x);
  }, [setSidebarOpen]);

  return (
    <Canvas ctx={ctx}>
      <DatoContext.Provider value={ctx}>
        <div className={s['layout']}>
          {isSidebarOpen && (
            <div className={s['layoutSidebar']}>
              <Toolbar>
                <ToolbarStack>
                  <ToolbarTitle>Models</ToolbarTitle>
                  <div style={{ flex: '1' }} />
                </ToolbarStack>
                <ToolbarButton onClick={handleToggleSidebar}>
                  <ToolbarSidebarLeftArrowIcon />
                </ToolbarButton>
              </Toolbar>
              <SidebarPanel title="Bella storia">Whazaaa</SidebarPanel>
            </div>
          )}
          <div className={s['layoutMain']}>
            <Toolbar>
              {!isSidebarOpen && (
                <ToolbarButton onClick={handleToggleSidebar}>
                  <ToolbarSidebarRightArrowIcon />
                </ToolbarButton>
              )}
              <ToolbarStack stackSize="l">
                <ToolbarTitle>{format(date, 'LLLL yyyy')}</ToolbarTitle>
                <div style={{ flex: '1' }} />
                <ButtonGroup>
                  <ButtonGroupButton onClick={handlePrev}>
                    Prev month
                  </ButtonGroupButton>
                  <ButtonGroupButton
                    onClick={handleCurr}
                    selected={isThisMonth(date)}
                  >
                    Today
                  </ButtonGroupButton>
                  <ButtonGroupButton onClick={handleNext}>
                    Next month
                  </ButtonGroupButton>
                </ButtonGroup>
              </ToolbarStack>
            </Toolbar>
            <div className={s['layoutCal']}>
              <CalendarGrid month={date} />
            </div>
          </div>
        </div>
      </DatoContext.Provider>
    </Canvas>
  );
}
