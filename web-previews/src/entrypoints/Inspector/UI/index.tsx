import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { BrowserWrapper } from '../../../components/Browser/BrowserWrapper';
import { IframeContainer } from '../../../components/Browser/IframeContainer';
import { Toolbar } from '../../../components/Browser/Toolbar';
import { ToolbarSlot } from '../../../components/Browser/Toolbar/ToolbarSlot';
import { ViewportCustomizer } from '../../../components/Browser/ViewportCustomizer';
import type { ViewportSize } from '../../../components/Browser/ViewportCustomizer';
import { ViewportSelector } from '../../../components/Browser/ViewportSelector';
import {
  type Parameters,
  type Viewport,
  normalizeParameters,
} from '../../../types';
import { useContentLink } from '../ContentLinkContext';
import AddressBar from './AddressBar';
import { EditModeToggle } from './EditModeToggle';

const UI: React.FC = () => {
  const ctx = useCtx<RenderInspectorCtx>();

  const { visualEditing, iframeAllowAttribute } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );

  if (!visualEditing) {
    return null;
  }

  const { iframeRef, iframeState, reloadIframe, contentLink } =
    useContentLink();

  const iframeSrc = useMemo(() => {
    const url = new URL(visualEditing.enableDraftModeUrl);
    url.searchParams.set('redirect', iframeState.path);
    return url.toString();
  }, [visualEditing.enableDraftModeUrl, iframeState.path]);

  const [customViewportSize, setCustomViewportSize] = useState<ViewportSize>({
    width: 800,
    height: 600,
  });

  const [currentViewport, setCurrentViewport] = useState<
    Viewport | 'responsive' | 'custom'
  >('responsive');

  const handleViewportChange = useCallback(
    (viewport: Viewport | 'responsive' | 'custom') => {
      setCurrentViewport(viewport);
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    reloadIframe();
  }, [reloadIframe]);

  const handleToggleClickToEdit = async () => {
    if (contentLink.type !== 'connected') {
      return;
    }

    contentLink.methods.setClickToEditEnabled(
      contentLink.state.clickToEditEnabled
        ? {
            enabled: false,
          }
        : { enabled: true, flash: { scrollToNearestTarget: true } },
    );
  };

  return (
    <BrowserWrapper>
      <Toolbar>
        <ToolbarSlot withLeftBorder>
          <ViewportSelector
            menuAlignment="left"
            currentViewport={currentViewport}
            onChange={handleViewportChange}
          />
        </ToolbarSlot>
        <ToolbarSlot flex withLeftBorder withPadding={9}>
          <AddressBar onRefresh={handleRefresh} />
        </ToolbarSlot>
        <ToolbarSlot withLeftBorder>
          <EditModeToggle
            value={
              contentLink.type !== 'connected'
                ? false
                : contentLink.state.clickToEditEnabled
            }
            disabled={contentLink.type !== 'connected'}
            onChange={handleToggleClickToEdit}
          />
        </ToolbarSlot>
      </Toolbar>

      {currentViewport === 'custom' && (
        <ViewportCustomizer
          size={customViewportSize}
          onChange={setCustomViewportSize}
        />
      )}

      <IframeContainer
        key={iframeState.key}
        src={iframeSrc}
        iframeRef={iframeRef}
        loading={contentLink.type === 'connecting'}
        allow={iframeAllowAttribute}
        error={
          contentLink.type === 'error'
            ? 'Unable to connect to preview. Please ensure @datocms/content-link is installed and configured correctly on your website.'
            : undefined
        }
        sizing={
          currentViewport === 'responsive'
            ? 'responsive'
            : currentViewport === 'custom'
              ? customViewportSize
              : currentViewport
        }
      />
    </BrowserWrapper>
  );
};

export default UI;
