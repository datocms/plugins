import { Button, Spinner, TextField } from 'datocms-react-ui';
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

/** Two-circular-arrows "regenerate" glyph (icons aren't shippable from the SDK). */
const RegenerateIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const linkButtonStyle: CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: 0,
  margin: 0,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  textDecoration: 'underline',
  cursor: 'pointer',
};

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
 * field carries an inline regenerate icon; one "Save and copy" action persists
 * the secret and puts it on the clipboard for the deployment env var. Editing a
 * saved secret raises a warning (with a "Revert to saved?" escape hatch), and a
 * provider deploy menu + paste callout are revealed once a secret is saved.
 */
export const StepSecret = ({ config }: { config: BackupsConfig }) => {
  const {
    secretInput,
    setSecretInput,
    saveAndCopySecret,
    regenerateSecret,
    revertSecret,
    isSavingSecret,
    savedSecret,
    isConnected,
  } = config;

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasSavedSecret = savedSecret.trim().length > 0;
  const trimmedInput = secretInput.trim();
  const secretEdited = hasSavedSecret && trimmedInput !== savedSecret.trim();

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
      <div style={{ display: 'flex', gap: 'var(--spacing-s)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <TextField
            name="lambdaAuthSecret"
            id="lambdaAuthSecret"
            label="Shared auth secret"
            value={secretInput}
            placeholder="Generate a strong secret"
            onChange={setSecretInput}
          />
        </div>
        {/* Native title on the wrapping span carries the tooltip — the icon-only
            Button has no text label. */}
        <span title="Regenerate shared secret" style={{ display: 'inline-flex' }}>
          <Button
            buttonType="muted"
            buttonSize="xs"
            onClick={regenerateSecret}
            disabled={isSavingSecret}
            aria-label="Regenerate shared secret"
          >
            <RegenerateIcon />
          </Button>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--spacing-s)', flexWrap: 'wrap' }}>
        <Button
          buttonType="primary"
          buttonSize="s"
          onClick={() => {
            void saveAndCopySecret();
          }}
          disabled={isSavingSecret || trimmedInput.length === 0}
          leftIcon={isSavingSecret ? <Spinner size={16} /> : undefined}
        >
          {isSavingSecret ? 'Saving…' : 'Save and copy'}
        </Button>
      </div>

      {secretEdited && (
        <StatusBox variant="warning">
          {isConnected ? (
            <>
              Changing this means updating{' '}
              <code>DATOCMS_BACKUPS_SHARED_SECRET</code> on your deployment and
              redeploying, or the connection will fail.{' '}
            </>
          ) : (
            <>You&rsquo;ve modified the saved secret. </>
          )}
          <button type="button" onClick={revertSecret} style={linkButtonStyle}>
            Revert to saved?
          </button>
        </StatusBox>
      )}

      {hasSavedSecret && (
        <>
          <StatusBox variant="neutral" title="Deploy the scheduler">
            Deploy the scheduler to your provider, setting{' '}
            <code>DATOCMS_BACKUPS_SHARED_SECRET</code> to the secret above. Once
            you have the deployed URL, continue to the next step.
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
