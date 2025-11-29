import React, { useCallback } from 'react';
import AddressBar from './AddressBar';
import { useContentLink } from '../ContentLinkContext';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Spinner, SwitchInput } from 'datocms-react-ui';

interface BrowserProps {
  domain: string;
}

const UI: React.FC<BrowserProps> = ({ domain }) => {
  const { iframeRef, iframeState, reloadIframe, contentLink } =
    useContentLink();

  const handleRefresh = useCallback(() => {
    reloadIframe();
  }, []);

  const handleToggleClickToEdit = async () => {
    if (contentLink.type !== 'connected') {
      return;
    }

    contentLink.methods.setClickToEditEnabled({
      enabled: !contentLink.state.clickToEditEnabled,
    });
  };

  return (
    <div className="VisualEditing_browser">
      <div className="PreviewToolbar">
        <label>
          <SwitchInput
            name="clickToEditEnabled"
            value={
              contentLink.type !== 'connected'
                ? false
                : contentLink.state.clickToEditEnabled
            }
            disabled={contentLink.type !== 'connected'}
            onChange={handleToggleClickToEdit}
          />
          Edit mode
        </label>
        <button
          onClick={handleRefresh}
          className="PreviewToolbar__button"
          type="button"
          title="Refresh preview"
        >
          <FontAwesomeIcon icon={faArrowsRotate} />
        </button>
        <AddressBar domain={domain} />
      </div>
      <div className="PreviewIFrame">
        {contentLink.type === 'connecting' && (
          <div className="PreviewIFrame__loading">
            <Spinner size={80} placement="centered" />
          </div>
        )}

        {contentLink.type === 'error' && (
          <div className="PreviewIFrame__error">
            <p>Unable to connect to preview.</p>
            <p>
              Please ensure @datocms/content-link is installed and configured
              correctly on your website.
            </p>
          </div>
        )}

        {contentLink.type !== 'error' && (
          <iframe
            key={iframeState.key}
            ref={iframeRef}
            src={`${domain}${iframeState.path}`}
            className="PreviewIFrame__frame"
            title="Preview"
          />
        )}
      </div>
    </div>
  );
};

export default UI;
