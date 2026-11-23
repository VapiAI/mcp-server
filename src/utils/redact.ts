import { VapiError } from '@vapi-ai/server-sdk';

const SECRET_FIELD = /token|secret|key|auth|password|passwd|signature|cookie/i;
const EXACT_SECRET_FIELDS = ['sig', 'credential'];
const INLINE_CREDENTIAL = new RegExp(
  String.raw`(^|[^\w.-])([\w.-]*(?:${SECRET_FIELD.source})[\w.-]*|${EXACT_SECRET_FIELDS.join('|')})(["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;{}&]+)`,
  'gi'
);
const CREDENTIAL_REFERENCE = /^credential[-_]?ids?$/i;
const SAFE_HEADERS = new Set(['accept', 'content-type']);
export const REDACTED = '[REDACTED]';

function isSecretField(key: string): boolean {
  return !CREDENTIAL_REFERENCE.test(key) && (SECRET_FIELD.test(key) || EXACT_SECRET_FIELDS.includes(key.toLowerCase()));
}

export function isRedactedHeader(name: string): boolean {
  return !SAFE_HEADERS.has(name.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function containsRedactionMarker(value: unknown): boolean {
  if (typeof value === 'string') {
    let found = false;
    replaceUrlCredentials(value, credential => {
      found ||= credential.includes(REDACTED) || /%5bredacted%5d/i.test(credential);
      return credential;
    });
    return found;
  }
  if (Array.isArray(value)) return value.some(containsRedactionMarker);
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, item]) => {
    if (key.toLowerCase() === 'headers' && isRecord(item)) {
      return Object.entries(item).some(([name, header]) =>
        (isRedactedHeader(name) && header === REDACTED) || containsRedactionMarker(header)
      );
    }
    return (isSecretField(key) && item === REDACTED) || containsRedactionMarker(item);
  });
}

/** Redacts credential-bearing fields and URLs without modifying the source object. */
export function redactCredentials<T>(value: T): T {
  if (typeof value === 'string') return replaceUrlCredentials(value, () => REDACTED) as T;
  if (Array.isArray(value)) return value.map((item) => redactCredentials(item)) as T;
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key.toLowerCase() === 'headers' && isRecord(item)) {
        return [key, Object.fromEntries(
          Object.entries(item).map(([name, header]) => [
            name, isRedactedHeader(name) ? REDACTED : redactCredentials(header),
          ])
        )];
      }

      // JSON Schema property names are contract labels. Object schemas may omit type.
      if (
        key === 'properties' &&
        (value.type === undefined || value.type === 'object') &&
        isRecord(item) &&
        Object.values(item).every(schema => isRecord(schema) || typeof schema === 'boolean')
      ) {
        return [key, Object.fromEntries(
          Object.entries(item).map(([property, schema]) => [property, redactCredentials(schema)])
        )];
      }
      return [key, isSecretField(key) ? REDACTED : redactCredentials(item)];
    })
  ) as T;
}

/** Formats an exception for a public result or diagnostic with its credentials masked. */
export function redactErrorMessage(error: unknown): string {
  let message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);

  // The SDK appends the serialized body to the message. Sanitize its structure
  // first so even arbitrary header names inside that body are covered.
  if (error instanceof VapiError && (isRecord(error.body) || Array.isArray(error.body))) {
    const bodyLabel = /(?:^|\n)Body: /.exec(message);
    if (bodyLabel) {
      const bodyStart = bodyLabel.index + bodyLabel[0].length;
      message = message.slice(0, bodyStart) + JSON.stringify(redactCredentials(error.body), null, 2);
    }
  }

  return replaceUrlCredentials(message, () => REDACTED)
    // Cookie lines can contain multiple semicolon-delimited credential values.
    .replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
    .replace(INLINE_CREDENTIAL, (match, prefix: string, key: string, separator: string) =>
      isSecretField(key) ? `${prefix}${key}${separator}${REDACTED}` : match
    );
}

function replaceUrlCredentials(text: string, replace: (credential: string) => string): string {
  return text
    .replace(/(https?:\/\/)([^\s/@?#"'<>]+)@/gi, (_, scheme: string, credential: string) => `${scheme}${replace(credential)}@`)
    .replace(/([?&])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g, (match, separator: string, key: string, credential: string) => {
      try {
        return isSecretField(decodeURIComponent(key.replace(/\+/g, ' ')))
          ? `${separator}${key}=${replace(credential)}` : match;
      } catch {
        return match;
      }
    });
}
