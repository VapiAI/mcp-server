import { VapiError } from '@vapi-ai/server-sdk';

// Credential names can include a vendor prefix or use camel case.
// Matches X-Auth-Token, apiSecret and Ocp-Apim-Subscription-Key. Leaves region alone.
const SECRET_FIELD = /token|secret|key|auth|password|passwd|signature|cookie/i;

// Short names match only on their own. For example, sig matches and signal does not.
const EXACT_SECRET_FIELDS = ['sig', 'credential'];

// Diagnostic text can quote credentials as key/value pairs. Matches
// X-Auth-Token: abc and "password":"a\"b", including the escaped quote in the value.
// Leaves region=us and a standalone mention of the word password alone.
const INLINE_CREDENTIAL = new RegExp(
  String.raw`(^|[^\w.-])([\w.-]*(?:${SECRET_FIELD.source})[\w.-]*|${EXACT_SECRET_FIELDS.join('|')})(["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;{}&]+)`,
  'gi'
);

// Credential IDs are references callers use to select saved credentials.
// Matches credentialId and credential_ids. Leaves credential and clientSecret
// subject to the credential-name rules.
const CREDENTIAL_REFERENCE = /^credential[-_]?ids?$/i;

// Custom header names have no reliable naming convention for secrets. Only
// these known content-negotiation headers have their values shown by default.
const SAFE_HEADERS = new Set(['accept', 'content-type']);
export const REDACTED = '[REDACTED]';

/** A local update validation error with guidance safe to return to the caller. */
export class ReplacementCredentialsRequiredError extends Error {}

// Use the same name rules for object fields, query keys and diagnostic text.
function isSecretField(key: string): boolean {
  return !CREDENTIAL_REFERENCE.test(key) &&
    (SECRET_FIELD.test(key) || EXACT_SECRET_FIELDS.includes(key.toLowerCase()));
}

/** Keeps response masking and update-time restoration in agreement about custom headers. */
export function isRedactedHeader(name: string): boolean {
  return !SAFE_HEADERS.has(name.toLowerCase());
}

// Only records have named fields to inspect. Arrays are traversed separately.
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reject display placeholders that survived header restoration before writing
 * a tool update. Free text such as a description can contain the literal marker.
 */
export function containsRedactionMarker(value: unknown): boolean {
  if (typeof value === 'string') {
    let found = false;
    replaceUrlCredentials(value, credential => {
      // URL serialization may escape the brackets in [REDACTED] as
      // %5BREDACTED%5D. A plain value such as redacted stays valid.
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

/**
 * Mask credential fields, header values and URLs in a copy for MCP output.
 * Internal code can still work with the original payload.
 */
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

/**
 * Upstream exceptions can include configuration values. Mask them before
 * formatting a public MCP error or writing it to stderr.
 */
export function redactErrorMessage(error: unknown): string {
  let message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);

  // The SDK appends the serialized body to the message. Sanitize its structure
  // first so even arbitrary header names inside that body are covered.
  if (error instanceof VapiError && (isRecord(error.body) || Array.isArray(error.body))) {
    // The SDK writes Body: at the start of a line. An inline reference such as
    // Invalid Body: missing field is ordinary message text.
    const bodyLabel = /(?:^|\n)Body: /.exec(message);
    if (bodyLabel) {
      const bodyStart = bodyLabel.index + bodyLabel[0].length;
      message = message.slice(0, bodyStart) + JSON.stringify(redactCredentials(error.body), null, 2);
    }
  }

  return replaceUrlCredentials(message, () => REDACTED)
    // Cookie and Set-Cookie can carry several semicolon-delimited values.
    // Cookie: session=abc; theme=dark becomes Cookie: [REDACTED].
    // A JSON key such as "cookie" is handled by the inline matcher.
    .replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, `$1${REDACTED}`)
    // A diagnostic can echo an auth value without its header name.
    // Bearer abc and Basic YTpi match. Token abc stays as written here.
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`)
    .replace(INLINE_CREDENTIAL, (match, prefix: string, key: string, separator: string) =>
      isSecretField(key) ? `${prefix}${key}${separator}${REDACTED}` : match
    );
}

/**
 * Customers can put authorization secrets in URL userinfo or query parameters.
 * With the masking callback, https://example.com/?bearer-token=FAOFNEAUFN1244
 * becomes https://example.com/?bearer-token=[REDACTED].
 * Update validation uses the same matches to detect placeholders in echoed URLs.
 */
function replaceUrlCredentials(text: string, replace: (credential: string) => string): string {
  return text
    // Matches user:pass in https://user:pass@example.com. An address in
    // https://example.com/?contact=user@example.com is outside the authority.
    .replace(/(https?:\/\/)([^\s/@?#"<>]+)@/gi, (_, scheme: string, credential: string) => `${scheme}${replace(credential)}@`)
    // Matches the value of each ?name=value or &name=value pair, including
    // repeated keys. A value ends at &, # or a text delimiter, so the
    // trailing #section in ?token=abc#section is kept. Ordinary keys stay visible.
    .replace(/([?&])([^=&#\s"<>]+)=([^&#\s"<>]*)/g, (match, separator: string, key: string, credential: string) => {
      try {
        // Decode the key so a%70i_key matches api_key. Preserve the caller's
        // spelling in the output and leave malformed percent escapes alone.
        return isSecretField(decodeURIComponent(key.replace(/\+/g, ' ')))
          ? `${separator}${key}=${replace(credential)}` : match;
      } catch {
        return match;
      }
    });
}
