import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import classNames from 'classnames';
import type { RenderInspectorCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type Parameters, normalizeParameters } from '../../../../types';
import { useContentLink } from '../../ContentLinkContext';
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
}

function AddressBar({ onRefresh }: AddressBarProps) {
  const ctx = useCtx<RenderInspectorCtx>();

  const { visualEditing } = normalizeParameters(
    ctx.plugin.attributes.parameters as Parameters
  );

  if (!visualEditing) {
    return null;
  }

  const visualEditingOrigin = new URL(visualEditing.enableDraftModeUrl).origin;

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
      <button
        type="button"
        onClick={onRefresh}
        className={styles.refreshButton}
        title="Reload page"
      >
        <FontAwesomeIcon icon={faArrowsRotate} />
      </button>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="/"
        className={styles.input}
      />
    </form>
  );
}

export default AddressBar;
