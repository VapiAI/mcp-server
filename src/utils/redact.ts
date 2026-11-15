const SECRET_FIELD = /(?:authorization|proxy-authorization|cookie|set-cookie|x-vapi-secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|secret|credential|private[-_]?key)/i;
const REDACTED = '[REDACTED]';

function isSecretField(key: string): boolean {
  // Keep credential references/IDs useful for support and reconciliation.
  if (/credential[-_]?id$/i.test(key)) return false;
  return SECRET_FIELD.test(key);
}

/** Redacts credential-bearing fields and URLs without modifying the source object. */
export function redactCredentials<T>(value: T): T {
  if (typeof value === 'string') return redactCredentialText(value, false) as T;
  if (Array.isArray(value)) return value.map(redactCredentials) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSecretField(key) ? REDACTED : redactCredentials(item),
    ])
  ) as T;
}

/** Formats an exception for a public result or diagnostic without exposing its body. */
export function redactErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
  return redactCredentialText(message, true);
}

function redactCredentialText(text: string, redactInlineCredentials: boolean): string {
  let safeText = text
    // Credentials embedded in URL userinfo.
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    // Secret query parameters, preserving the URL and all ordinary parameters.
    .replace(
      /([?&](?:authorization|proxy-authorization|cookie|set-cookie|x-vapi-secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|secret|credential|private[-_]?key)=)[^&#\s]*/gi,
      `$1${REDACTED}`
    );

  if (redactInlineCredentials) {
    safeText = safeText
      // Common authorization values in upstream error messages and bodies.
      .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
      .replace(
        /((?:authorization|proxy-authorization|cookie|set-cookie|x-vapi-secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|secret|credential|private[-_]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
        `$1${REDACTED}`
      );
  }
  return safeText;
}
