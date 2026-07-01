/** Bytes of entropy (128 bits) behind a generated lambda auth secret. */
export const AUTH_SECRET_BYTE_LENGTH = 16;

/** Length of the hex-encoded secret produced by {@link generateAuthSecret}. */
export const AUTH_SECRET_HEX_LENGTH = AUTH_SECRET_BYTE_LENGTH * 2;

/**
 * Generate a random lambda auth secret: 128 bits of entropy as a 32-character
 * lowercase hex string. Hex keeps it URL-safe and comfortably within every
 * deploy provider's environment-variable value limit.
 *
 * Uses the Web Crypto API (`crypto.getRandomValues`), which is available in both
 * the browser plugin runtime and Node's test environment.
 */
export const generateAuthSecret = (): string => {
  const bytes = new Uint8Array(AUTH_SECRET_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
};
