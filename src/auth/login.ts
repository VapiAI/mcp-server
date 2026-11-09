import { OAUTH_SCOPES, type OAuthSettings } from './config.js';
import { AuthError } from './errors.js';
import { openBrowser as defaultOpenBrowser } from './browser.js';
import { startLoopbackReceiver } from './loopback.js';
import {
  decodeJwtClaims,
  discoverAuthorizationServer,
  requestToken,
  type FetchLike,
} from './oauthClient.js';
import { codeChallengeFor, createCodeVerifier, createState } from './pkce.js';
import { writeCredentials, type StoredCredentials } from './store.js';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface LoginOptions {
  settings: OAuthSettings;
  path: string;
  log?: (message: string) => void;
  openBrowser?: (url: string) => void;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface SignedInIdentity {
  userId?: string;
  orgId?: string;
}

export function identityFromAccessToken(accessToken: string): SignedInIdentity {
  const claims = decodeJwtClaims(accessToken);
  return {
    userId: typeof claims.vapi_user_id === 'string' ? claims.vapi_user_id : undefined,
    orgId: typeof claims.vapi_org_id === 'string' ? claims.vapi_org_id : undefined,
  };
}

// OAuth 2.1 authorization code + PKCE as a public client (no secret), with a
// loopback redirect. The user signs in with their normal Vapi login and picks
// one org on the consent screen; the resulting tokens are saved to `path`.
export async function login(options: LoginOptions): Promise<SignedInIdentity> {
  const { settings, path } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  const fetchImpl = options.fetchImpl ?? fetch;

  const metadata = await discoverAuthorizationServer(settings.issuer, fetchImpl);
  const verifier = createCodeVerifier();
  const state = createState();
  const receiver = await startLoopbackReceiver();

  let code: string;
  try {
    const authorizeUrl = new URL(metadata.authorization_endpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: receiver.redirectUri,
      scope: OAUTH_SCOPES.join(' '),
      state,
      code_challenge: codeChallengeFor(verifier),
      code_challenge_method: 'S256',
      resource: settings.audience,
    }).toString();

    const codePromise = receiver.waitForCode(state, options.timeoutMs ?? LOGIN_TIMEOUT_MS);
    log('Opening your browser to sign in to Vapi.');
    log(`If it does not open, visit this URL:\n\n  ${authorizeUrl}\n`);
    (options.openBrowser ?? defaultOpenBrowser)(authorizeUrl.toString());
    code = await codePromise;
  } finally {
    receiver.close();
  }

  const tokens = await requestToken(
    metadata.token_endpoint,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: receiver.redirectUri,
      client_id: settings.clientId,
      code_verifier: verifier,
      resource: settings.audience,
    },
    { fetchImpl }
  );
  if (!tokens.refreshToken) {
    throw new AuthError(
      'Vapi sign-in did not return a refresh token, so it would expire within the hour. Check that the client is allowed the offline_access scope.'
    );
  }

  const identity = identityFromAccessToken(tokens.accessToken);
  const credentials: StoredCredentials = {
    version: 1,
    issuer: settings.issuer,
    clientId: settings.clientId,
    audience: settings.audience,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    ...identity,
  };
  await writeCredentials(path, credentials);
  return identity;
}
