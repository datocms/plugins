import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import { Tooltip, TooltipContent, TooltipTrigger } from 'datocms-react-ui';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { Frontend } from '../../../../types';
import { useContentLink } from '../../ContentLinkContext';
import { FrontendSelector } from './FrontendSelector';
import styles from './styles.module.css';

export function toCompletePath(urlOrPath: string) {
  const url = new URL(urlOrPath, 'https://example.com');
  return url.pathname + url.search + url.hash;
}

function isRelativeUrl(str: string) {
  try {
    new URL(str);
    // No error → it's absolute
    return false;
  } catch {
    try {
      new URL(str, 'http://example.com');
      // Works only with a base → relative
      return true;
    } catch {
      // Doesn't work even with base → not a URL at all
      return false;
    }
  }
}

interface AddressBarProps {
  onRefresh: () => void;
  frontend: Frontend;
  frontends: Frontend[];
  onFrontendChange?: (frontend: Frontend) => void;
}

function AddressBar({
  onRefresh,
  frontend,
  frontends,
  onFrontendChange,
}: AddressBarProps) {
  const visualEditingOrigin = new URL(
    frontend.visualEditing!.enableDraftModeUrl,
  ).origin;

  const { contentLink, iframeState } = useContentLink();

  const currentPath =
    contentLink.type === 'connecting'
      ? iframeState.path
      : contentLink.type === 'connected'
        ? toCompletePath(contentLink.state.path)
        : '/';

  const [inputValue, setInputValue] = useState(currentPath);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setInputValue(new URL(currentPath, visualEditingOrigin).toString());
    setHasError(false);
  }, [visualEditingOrigin, currentPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (contentLink.type !== 'connected') {
      return;
    }

    // Check if input is a full URL
    if (!isRelativeUrl(inputValue)) {
      try {
        const inputUrl = new URL(inputValue);
        const domainUrl = new URL(visualEditingOrigin);

        // Check if the domain matches
        if (inputUrl.origin === domainUrl.origin) {
          // Correct domain - extract the path and navigate
          const path = toCompletePath(inputValue);
          setHasError(false);
          await contentLink.methods.navigateTo({ path });
        } else {
          // Wrong domain - mark as error
          setHasError(true);
        }
      } catch {
        // Invalid URL - mark as error
        setHasError(true);
      }
    } else {
      // Relative path - navigate directly
      setHasError(false);
      await contentLink.methods.navigateTo({ path: inputValue });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setInputValue(new URL(currentPath, visualEditingOrigin).toString());
      setHasError(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={classNames(styles.root, hasError && styles.error)}
    >
      <div className={styles.controls}>
        <Tooltip>
          <TooltipTrigger>
            <button
              type="button"
              onClick={onRefresh}
              className={styles.refreshButton}
            >
              <FontAwesomeIcon icon={faArrowsRotate} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reload page</TooltipContent>
        </Tooltip>
        {frontends.length > 1 && onFrontendChange && (
          <FrontendSelector
            frontends={frontends}
            currentFrontend={frontend}
            onChange={onFrontendChange}
          />
        )}
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="/"
        className={styles.input}
        disabled={contentLink.type !== 'connected'}
      />
    </form>
  );
}

export default AddressBar;
