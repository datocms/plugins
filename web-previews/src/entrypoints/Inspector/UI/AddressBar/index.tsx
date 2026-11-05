import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import InputGroup from 'datocms-react-ui/InputGroup';
import Toolbar from 'datocms-react-ui/Toolbar';
import Tooltip from 'datocms-react-ui/Tooltip';
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Frontend } from '../../../../types';
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

/**
 * The page that the website opens for the text of the field: a relative path
 * as it is, the path of a full URL of the website, or nothing for a URL of
 * another origin or a text that is not a URL.
 */
function pathToOpen(text: string, origin: string): string | undefined {
  if (isRelativeUrl(text)) {
    return text;
  }

  try {
    return new URL(text).origin === origin ? toCompletePath(text) : undefined;
  } catch {
    return undefined;
  }
}

/** The path of a full URL of the website, for a paste in the field */
function pathOfWebsiteUrl(text: string, origin: string): string | undefined {
  return isRelativeUrl(text) ? undefined : pathToOpen(text, origin);
}

/**
 * The field shows the host of the website before the path only from this
 * width. The kit cuts a long addon at half the field: in a narrower field a
 * common host would end with an ellipsis, and the path would lose its room.
 */
const HOST_MIN_FIELD_WIDTH = 400;

interface AddressBarProps {
  frontend: Frontend;
  /**
   * Why the field is disabled, while the page is not connected: the same
   * text as the edit mode switch
   */
  disabledReason?: string;
}

/**
 * The address of the page that the preview shows: the origin of the website
 * is fixed, and the user types the path of another page. Enter opens it.
 */
function AddressBar({ frontend, disabledReason }: AddressBarProps) {
  const enableDraftModeUrl = frontend.visualEditing?.enableDraftModeUrl;

  if (!enableDraftModeUrl) {
    throw new Error(
      `Frontend "${frontend.name}" is missing visualEditing configuration.`,
    );
  }

  const visualEditingOrigin = new URL(enableDraftModeUrl).origin;
  // The host, as a browser shows it
  const host = new URL(visualEditingOrigin).host;

  const formRef = useRef<HTMLFormElement>(null);
  const showHost = useElementLayout(formRef).width >= HOST_MIN_FIELD_WIDTH;

  const { contentLink, iframeState } = useContentLink();

  const connectedPath =
    contentLink.type === 'connected'
      ? toCompletePath(contentLink.state.path)
      : undefined;

  // The last page that the website said it shows, for the page that the
  // preview asked it to load. The user can navigate in the website, so the
  // iframe shows that page, not the one that the preview loaded.
  const lastConnectedRef = useRef<
    { loadedPath: string; path: string } | undefined
  >(undefined);

  useEffect(() => {
    if (connectedPath !== undefined) {
      lastConnectedRef.current = {
        loadedPath: iframeState.path,
        path: connectedPath,
      };
    }
  }, [connectedPath, iframeState.path]);

  // While the page isn't connected (it connects again, or it stopped
  // answering), the field keeps the last page that the website showed. A new
  // load of another page shows that page until the website answers.
  const lastConnected = lastConnectedRef.current;
  const currentPath =
    connectedPath ??
    (lastConnected?.loadedPath === iframeState.path
      ? lastConnected.path
      : iframeState.path);

  const disabled = contentLink.type !== 'connected';

  const [inputValue, setInputValue] = useState(currentPath);
  const [hasError, setHasError] = useState(false);

  // The field follows the page when the website navigates
  useEffect(() => {
    setInputValue(currentPath);
    setHasError(false);
  }, [currentPath]);

  // A field that gets disabled (the page stopped answering) drops what the
  // user typed, and shows the page again
  useEffect(() => {
    if (disabled) {
      setInputValue(currentPath);
      setHasError(false);
    }
  }, [disabled, currentPath]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (contentLink.type !== 'connected') {
      return;
    }

    const path = pathToOpen(inputValue, visualEditingOrigin);

    if (path === undefined) {
      setHasError(true);
      return;
    }

    setHasError(false);
    await contentLink.methods.navigateTo({ path });
  };

  // Escape is a key of the field itself, as the keys of a text editor: the
  // field handles it and says so, thus no action of the page or of the host
  // runs with the same key
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setInputValue(currentPath);
      setHasError(false);
      event.currentTarget.blur();
    }
  };

  // A pasted URL of the website keeps only its page: the field holds the
  // path, and the host shows before it when there is room
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const path = pathOfWebsiteUrl(
      event.clipboardData.getData('text').trim(),
      visualEditingOrigin,
    );

    if (path !== undefined) {
      event.preventDefault();
      setInputValue(path);
    }
  };

  return (
    <Toolbar.Fill className={styles.fill}>
      {/* A disabled input takes no focus: the tooltip opens on hover */}
      <Tooltip label={disabled && disabledReason}>
        <form ref={formRef} className={styles.form} onSubmit={handleSubmit}>
          {/* The input names itself, so the field has no label: a hidden one
              would still take room above the box, and the box would sit lower
              than the buttons of the bar */}
          <FieldWrapper
            error={hasError ? `Only pages of ${host} open here` : undefined}
          >
            {/* The host shows only before a path: a full URL that the user
                types or pastes shows alone, as it is */}
            <InputGroup
              aria-label="Page"
              pre={showHost && isRelativeUrl(inputValue) ? host : undefined}
              placeholder="/"
              value={inputValue}
              onChange={(value) => setInputValue(value ?? '')}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
          </FieldWrapper>
        </form>
      </Tooltip>
    </Toolbar.Fill>
  );
}

export default AddressBar;
