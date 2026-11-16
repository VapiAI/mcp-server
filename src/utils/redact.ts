const SECRET_FIELD = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-vapi-secret|(?:x[-_])?api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|secret|credential|private[-_]?key)$/i;
const REDACTED = '[REDACTED]';

export function containsRedactionMarker(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(REDACTED);
  if (Array.isArray(value)) return value.some(containsRedactionMarker);
  return !!value && typeof value === 'object' && Object.values(value).some(containsRedactionMarker);
}

function isSecretField(key: string): boolean {
  // Keep credential references/IDs useful for support and reconciliation.
  return SECRET_FIELD.test(key);
}

/** Redacts credential-bearing fields and URLs without modifying the source object. */
export function redactCredentials<T>(value: T): T {
  if (typeof value === 'string') return redactCredentialText(value, false) as T;
  if (Array.isArray(value)) return value.map((item) => redactCredentials(item)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      // A JSON Schema property name is a contract label, not a credential value.
      if (
        key === 'properties' &&
        (value as { type?: unknown }).type === 'object' &&
        item &&
        typeof item === 'object' &&
        !Array.isArray(item)
      ) {
        return [
          key,
          Object.fromEntries(
            Object.entries(item).map(([property, schema]) => [
              property,
              redactCredentials(schema),
            ])
          ),
        ];
      }
      return [key, isSecretField(key) ? REDACTED : redactCredentials(item)];
    })
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
    .replace(/(https?:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`)
    // Secret query parameters, preserving the URL and all ordinary parameters.
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator: string, key: string) => {
      try {
        return isSecretField(decodeURIComponent(key.replace(/\+/g, ' ')))
          ? `${separator}${key}=${REDACTED}` : match;
      } catch {
        return match;
      }
    });

  if (redactInlineCredentials) {
    safeText = safeText
      // A Cookie header contains semicolon-delimited credentials; redact the whole line.
      .replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, `$1${REDACTED}`)
      // Common authorization values in upstream error messages and bodies.
      .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
      .replace(
        /((?:authorization|proxy-authorization|cookie|set-cookie|x-vapi-secret|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|secret|credential|private[-_]?key)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)/gi,
        `$1${REDACTED}`
      );
  }
  return safeText;
}
