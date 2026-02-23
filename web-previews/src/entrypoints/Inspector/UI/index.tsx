import cuid from 'cuid';
import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserWrapper } from '../../../components/Browser/BrowserWrapper';
import { IframeContainer } from '../../../components/Browser/IframeContainer';
import { Toolbar } from '../../../components/Browser/Toolbar';
import { ToolbarSlot } from '../../../components/Browser/Toolbar/ToolbarSlot';
import { ViewportCustomizer } from '../../../components/Browser/ViewportCustomizer';
import type { ViewportSize } from '../../../components/Browser/ViewportCustomizer';
import { ViewportSelector } from '../../../components/Browser/ViewportSelector';
import {
  type Frontend,
  type Parameters,
  type Viewport,
  getVisualEditingFrontends,
  normalizeParameters,
} from '../../../types';
import { inspectorUrl } from '../../../utils/urls';
import { useContentLink } from '../ContentLinkContext';
import { normalizePathForVisualEditing } from '../normalizePathForVisualEditing';
import AddressBar from './AddressBar';
import { EditModeToggle } from './EditModeToggle';

const UI: React.FC = () => {
  const ctx = useCtx<RenderInspectorCtx>();

  const params = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters,
  );
  const { iframeAllowAttribute } = params;
  const visualEditingFrontends = getVisualEditingFrontends(params);

  const [selectedFrontend, setSelectedFrontend] = useState<Frontend>(() => {
    const urlParams = new URLSearchParams(ctx.location.search);
    const frontendName = urlParams.get('frontend');
    if (frontendName) {
      return (
        visualEditingFrontends.find((f) => f.name === frontendName) ||
        visualEditingFrontends[0]
      );
    }
    return visualEditingFrontends[0];
  });

  const currentVisualEditing = selectedFrontend.visualEditing!;
  const fallbackPath = currentVisualEditing.initialPath || '/';

  const { iframeRef, iframeState, setIframeState, reloadIframe, contentLink } =
    useContentLink();

  const iframeSrc = useMemo(() => {
    const url = new URL(currentVisualEditing.enableDraftModeUrl);
    // Re-validate at the sink so query-parameter tampering cannot reach `redirect`.
    url.searchParams.set(
      'redirect',
      normalizePathForVisualEditing({
        path: iframeState.path,
        draftModeUrl: currentVisualEditing.enableDraftModeUrl,
        fallbackPath,
      }),
    );
    return url.toString();
  }, [currentVisualEditing.enableDraftModeUrl, fallbackPath, iframeState.path]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (contentLink.type !== 'error') {
      return;
    }

    if (contentLink.reason === 'failed-connection') {
      ctx.alert(
        'Could not establish communication with the website. Please make sure that DatoCMS Content Link is properly installed on your website.',
      );
    }

    if (contentLink.reason === 'no-ping') {
      ctx.alert(
        'Connection to the website has been lost. You may have navigated away from the original site by clicking an external link. Please reload to reconnect.',
      );
    }
  }, [
    contentLink.type,
    contentLink.type === 'error' ? contentLink.reason : undefined,
  ]);

  // Handle frontend deletion while Inspector open
  useEffect(() => {
    if (!visualEditingFrontends.find((f) => f.name === selectedFrontend.name)) {
      setSelectedFrontend(visualEditingFrontends[0]);
    }
  }, [visualEditingFrontends, selectedFrontend.name]);

  return (
    <BrowserWrapper>
      <Toolbar>
        <ToolbarSlot>
          <ViewportSelector
            menuAlignment="left"
            currentViewport={currentViewport}
            onChange={handleViewportChange}
          />
        </ToolbarSlot>
        <ToolbarSlot flex withLeftBorder withPadding={9}>
          <AddressBar
            onRefresh={handleRefresh}
            frontend={selectedFrontend}
            frontends={visualEditingFrontends}
            onFrontendChange={(frontend) => {
              setSelectedFrontend(frontend);
              const frontendVisualEditing = frontend.visualEditing!;
              const path = normalizePathForVisualEditing({
                path: frontendVisualEditing.initialPath,
                draftModeUrl: frontendVisualEditing.enableDraftModeUrl,
                fallbackPath: '/',
              });
              // Reset to new frontend's initial path
              setIframeState({
                path,
                key: cuid(),
              });
              // Update URL
              ctx.navigateTo(
                inspectorUrl(ctx, {
                  path,
                  frontend: frontend.name,
                }),
              );
            }}
          />
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
