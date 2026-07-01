import { Button, TextField } from 'datocms-react-ui';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  DEPLOY_PROVIDER_OPTIONS,
  type DeployProvider,
} from '../utils/deployProviders';
import { StatusBox } from './StatusBox';
import type { BackupsConfig } from './useBackupsConfig';

const DEPLOY_MENU_ID = 'deploy-provider-menu';

const menuContainerStyle: CSSProperties = {
  position: 'relative',
  flex: '1 1 0',
};

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + var(--spacing-xs))',
  left: 0,
  zIndex: 1000,
  minWidth: '180px',
  width: '100%',
  border: '1px solid var(--color--border)',
  borderRadius: '6px',
  background: 'var(--color--surface)',
  boxShadow: '0 8px 24px rgb(0 0 0 / 12%)',
  padding: 'var(--spacing-xs) 0',
};

const menuOptionStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 0,
  background: 'transparent',
  color: 'var(--color--ink)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 'var(--font-size-s)',
  lineHeight: 1.3,
  padding: 'var(--spacing-s) var(--spacing-m)',
  textAlign: 'left',
};

/**
 * Step 1 — create/rotate the shared auth secret and deploy the scheduler. The
 * secret is generated (fresh install) or loaded as-is, saved explicitly, then a
 * provider deploy menu + paste callout are revealed. Editing a saved secret
 * while connected raises a redeploy warning.
 */
export const StepSecret = ({ config }: { config: BackupsConfig }) => {
  const {
    secretInput,
    setSecretInput,
    saveSecret,
    regenerateSecret,
    copySecret,
    isSavingSecret,
    savedSecret,
    isConnected,
  } = config;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasSavedSecret = savedSecret.trim().length > 0;
  const trimmedInput = secretInput.trim();
  const secretEdited = hasSavedSecret && trimmedInput !== savedSecret.trim();
  const showRedeployWarning = isConnected && secretEdited;

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isMenuOpen]);

  const handleDeployClick = (provider: DeployProvider) => {
    const option = DEPLOY_PROVIDER_OPTIONS.find(
      (candidate) => candidate.provider === provider,
    );
    setIsMenuOpen(false);
    if (option) {
      window.open(option.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsMenuOpen(false);
    }
  };

  return (
    <>
      <TextField
        name="lambdaAuthSecret"
        id="lambdaAuthSecret"
        label="Shared auth secret"
        value={secretInput}
        placeholder="Generate a strong secret"
        onChange={setSecretInput}
      />

      <div
        style={{
          display: 'flex',
          gap: 'var(--spacing-s)',
          flexWrap: 'wrap',
        }}
      >
        <Button
          buttonType="muted"
          buttonSize="s"
          onClick={regenerateSecret}
          disabled={isSavingSecret}
        >
          Generate
        </Button>
        <Button
          buttonType="muted"
          buttonSize="s"
          onClick={() => {
            void copySecret();
          }}
          disabled={trimmedInput.length === 0}
        >
          Copy
        </Button>
        <Button
          buttonType="primary"
          buttonSize="s"
          onClick={() => {
            void saveSecret();
          }}
          disabled={isSavingSecret || trimmedInput.length === 0}
        >
          {isSavingSecret ? 'Saving…' : 'Save secret'}
        </Button>
      </div>

      {showRedeployWarning && (
        <StatusBox variant="warning">
          Changing this means updating <code>DATOCMS_BACKUPS_SHARED_SECRET</code>{' '}
          on your deployment and redeploying, or the connection will fail.
        </StatusBox>
      )}

      {hasSavedSecret && (
        <>
          <StatusBox variant="neutral" title="Deploy the scheduler">
            Paste this value as <code>DATOCMS_BACKUPS_SHARED_SECRET</code> on your
            provider, then come back with the deployed URL.
            <span
              style={{
                display: 'block',
                marginTop: 'var(--spacing-s)',
                fontFamily: 'monospace',
                fontSize: 'var(--font-size-xs)',
                wordBreak: 'break-all',
                color: 'var(--color--ink)',
              }}
            >
              {savedSecret}
            </span>
          </StatusBox>

          <div
            ref={menuRef}
            style={{ ...menuContainerStyle, maxWidth: '260px' }}
            onKeyDown={handleMenuKeyDown}
          >
            <Button
              buttonType="muted"
              onClick={() => setIsMenuOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              aria-controls={isMenuOpen ? DEPLOY_MENU_ID : undefined}
              style={{ width: '100%' }}
            >
              Deploy to ▾
            </Button>

            {isMenuOpen && (
              <div
                id={DEPLOY_MENU_ID}
                role="menu"
                aria-label="Deploy scheduler providers"
                style={menuStyle}
              >
                {DEPLOY_PROVIDER_OPTIONS.map((option) => (
                  <button
                    key={option.provider}
                    type="button"
                    role="menuitem"
                    onClick={() => handleDeployClick(option.provider)}
                    style={menuOptionStyle}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};
