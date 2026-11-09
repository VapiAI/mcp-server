import { notSignedIn } from './errors.js';
import {
  discoverAuthorizationServer,
  requestToken,
  type FetchLike,
} from './oauthClient.js';
import {
  readCredentials,
  withCredentialsLock,
  writeCredentials,
  type StoredCredentials,
} from './store.js';

// Refresh this long before the access token expires.
const REFRESH_MARGIN_MS = 60_000;

export interface TokenProviderOptions {
  path: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

// Hands the Vapi SDK a current access token for each request, refreshing it
// from the saved refresh token when it is about to expire. Failed API requests
// are never replayed; an expired or revoked sign-in surfaces as an error
// telling the user to run `login` again.
export class OAuthTokenProvider {
  private readonly path: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private current?: StoredCredentials;
  private inflight?: Promise<string>;

  constructor(options: TokenProviderOptions) {
    this.path = options.path;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private usable(credentials: StoredCredentials | undefined): credentials is StoredCredentials & {
    accessToken: string;
  } {
    return (
      !!credentials?.accessToken &&
      typeof credentials.accessTokenExpiresAt === 'number' &&
      credentials.accessTokenExpiresAt - REFRESH_MARGIN_MS > this.now()
    );
  }

  async getAccessToken(): Promise<string> {
    if (this.usable(this.current)) {
      return this.current.accessToken;
    }
    // Concurrent tool calls share one refresh.
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    return withCredentialsLock(this.path, async () => {
      // Another process may have refreshed (and rotated the refresh token)
      // since we last looked, so always start from what is on disk.
      const saved = await readCredentials(this.path);
      if (!saved) {
        this.current = undefined;
        throw notSignedIn();
      }
      if (this.usable(saved)) {
        this.current = saved;
        return saved.accessToken;
      }

      const metadata = await discoverAuthorizationServer(saved.issuer, this.fetchImpl);
      const tokens = await requestToken(
        metadata.token_endpoint,
        {
          grant_type: 'refresh_token',
          refresh_token: saved.refreshToken,
          client_id: saved.clientId,
          resource: saved.audience,
        },
        { fetchImpl: this.fetchImpl, now: this.now }
      );
      const next: StoredCredentials = {
        ...saved,
        refreshToken: tokens.refreshToken ?? saved.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt,
      };
      await writeCredentials(this.path, next);
      this.current = next;
      return tokens.accessToken;
    });
  }
}
