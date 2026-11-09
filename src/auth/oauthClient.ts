import { AuthError, signInExpired } from './errors.js';

const REQUEST_TIMEOUT_MS = 10_000;

export type FetchLike = typeof fetch;

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  code_challenge_methods_supported?: string[];
}

// RFC 8414 discovery, falling back to OIDC discovery. The issuer in the
// metadata must match the configured one exactly.
export async function discoverAuthorizationServer(
  issuer: string,
  fetchImpl: FetchLike = fetch
): Promise<AuthorizationServerMetadata> {
  for (const path of [
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
  ]) {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, issuer), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new AuthError('Could not reach the Vapi sign-in server.');
    }
    if (!response.ok) {
      continue;
    }
    const metadata = (await response.json().catch(() => undefined)) as
      | Partial<AuthorizationServerMetadata>
      | undefined;
    if (
      !metadata ||
      metadata.issuer !== issuer ||
      typeof metadata.authorization_endpoint !== 'string' ||
      typeof metadata.token_endpoint !== 'string'
    ) {
      throw new AuthError('The Vapi sign-in server returned invalid metadata.');
    }
    if (
      metadata.code_challenge_methods_supported &&
      !metadata.code_challenge_methods_supported.includes('S256')
    ) {
      throw new AuthError('The Vapi sign-in server does not support PKCE (S256).');
    }
    return metadata as AuthorizationServerMetadata;
  }
  throw new AuthError('Could not find the Vapi sign-in server configuration.');
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  // Epoch milliseconds.
  expiresAt: number;
}

// Fallback lifetime when the server gives neither expires_in nor a JWT exp.
const DEFAULT_LIFETIME_MS = 5 * 60_000;

export function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) {
    return {};
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : {};
  } catch {
    return {};
  }
}

function expiresAtFor(accessToken: string, expiresIn: unknown, now: number): number {
  if (typeof expiresIn === 'number' && expiresIn > 0) {
    return now + expiresIn * 1000;
  }
  const exp = decodeJwtClaims(accessToken).exp;
  if (typeof exp === 'number') {
    return exp * 1000;
  }
  return now + DEFAULT_LIFETIME_MS;
}

// POSTs to the token endpoint. Errors carry the OAuth error code only, never
// the request or response body.
export async function requestToken(
  tokenEndpoint: string,
  params: Record<string, string>,
  { fetchImpl = fetch, now = Date.now }: { fetchImpl?: FetchLike; now?: () => number } = {}
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError('Could not reach the Vapi sign-in server.');
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : undefined;
    if (code === 'invalid_grant' && params.grant_type === 'refresh_token') {
      throw signInExpired();
    }
    throw new AuthError(
      `Vapi sign-in failed (${code ?? `HTTP ${response.status}`}).`
    );
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new AuthError('The Vapi sign-in server returned no access token.');
  }
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === 'string' && body.refresh_token
        ? body.refresh_token
        : undefined,
    expiresAt: expiresAtFor(body.access_token, body.expires_in, now()),
  };
}
