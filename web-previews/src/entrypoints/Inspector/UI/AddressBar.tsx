import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import { useContentLink } from '../ContentLinkContext';

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

type Props = {
  domain: string;
};

function AddressBar({ domain }: Props) {
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
    setInputValue(new URL(currentPath, domain).toString());
    setHasError(false);
  }, [currentPath]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (contentLink.type !== 'connected') {
      return;
    }

    // Check if input is a full URL
    if (!isRelativeUrl(inputValue)) {
      try {
        const inputUrl = new URL(inputValue);
        const domainUrl = new URL(domain);

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

  return (
    <form onSubmit={handleSubmit} className="AddressBar">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
        }}
        placeholder="/"
        className={classNames(
          'AddressBar__input',
          hasError && 'AddressBar__input--error'
        )}
      />
    </form>
  );
}

export default AddressBar;
