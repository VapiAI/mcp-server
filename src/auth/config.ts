import { AuthError } from './errors.js';

// Where `login` signs in. The production WorkOS Connect client for this
// package is not registered yet, so there are no built-in defaults: all three
// values must come from the environment until it is.
export interface OAuthSettings {
  // WorkOS Connect issuer (origin only, matching the tokens' `iss`).
  issuer: string;
  // Public client ID registered for this package. It has no secret; PKCE
  // protects the authorization code instead.
  clientId: string;
  // The Vapi API's audience. Sent as the RFC 8707 `resource` so the access
  // token can be used against the Vapi API directly.
  audience: string;
}

// offline_access is what gets a refresh token; without it the user would have
// to sign in again every hour.
export const OAUTH_SCOPES = ['openid', 'offline_access'];

const ENV_NAMES = {
  issuer: 'VAPI_OAUTH_ISSUER',
  clientId: 'VAPI_OAUTH_CLIENT_ID',
  audience: 'VAPI_OAUTH_AUDIENCE',
} as const;

function isLoopback(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function requireUrl(name: string, value: string, { originOnly = false } = {}): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthError(`${name} must be a URL.`);
  }
  // Plain http only for a local development server.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
    throw new AuthError(`${name} must use https.`);
  }
  if (originOnly && url.origin !== value) {
    throw new AuthError(`${name} must be an origin with no path or trailing slash.`);
  }
  return value;
}

export function oauthSettings(
  env: Record<string, string | undefined> = process.env
): OAuthSettings {
  const values = {
    issuer: env[ENV_NAMES.issuer]?.trim() ?? '',
    clientId: env[ENV_NAMES.clientId]?.trim() ?? '',
    audience: env[ENV_NAMES.audience]?.trim() ?? '',
  };
  const missing = (Object.keys(values) as (keyof typeof values)[])
    .filter((key) => !values[key])
    .map((key) => ENV_NAMES[key]);
  if (missing.length) {
    throw new AuthError(
      `Vapi sign-in is not configured. Set ${missing.join(', ')}, or use VAPI_TOKEN with a Vapi API key.`
    );
  }
  return {
    issuer: requireUrl(ENV_NAMES.issuer, values.issuer, { originOnly: true }),
    clientId: values.clientId,
    audience: requireUrl(ENV_NAMES.audience, values.audience),
  };
}
