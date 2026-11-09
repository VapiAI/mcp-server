import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { oauthSettings } from '../auth/config.js';
import { codeChallengeFor } from '../auth/pkce.js';
import { startLoopbackReceiver } from '../auth/loopback.js';
import { login } from '../auth/login.js';
import { OAuthTokenProvider } from '../auth/tokenProvider.js';
import { readCredentials, writeCredentials, type StoredCredentials } from '../auth/store.js';
import { resolveVapiToken } from '../auth/commands.js';

function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`;
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of request) body += chunk;
  return new URLSearchParams(body);
}

// A minimal WorkOS-Connect-like authorization server: discovery, plus a token
// endpoint that checks PKCE and rotates refresh tokens.
class FakeAuthServer {
  server!: Server;
  issuer = '';
  tokenRequests: URLSearchParams[] = [];
  challenges = new Map<string, string>(); // code -> challenge
  validRefreshTokens = new Set<string>();
  private refreshCount = 0;

  async start() {
    this.server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', this.issuer || 'http://127.0.0.1');
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return json(200, {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/oauth2/authorize`,
          token_endpoint: `${this.issuer}/oauth2/token`,
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url.pathname === '/oauth2/token' && request.method === 'POST') {
        const form = await readForm(request);
        this.tokenRequests.push(form);
        if (form.get('grant_type') === 'authorization_code') {
          const challenge = this.challenges.get(form.get('code') ?? '');
          if (!challenge || codeChallengeFor(form.get('code_verifier') ?? '') !== challenge) {
            return json(400, { error: 'invalid_grant' });
          }
        } else if (form.get('grant_type') === 'refresh_token') {
          const presented = form.get('refresh_token') ?? '';
          if (!this.validRefreshTokens.delete(presented)) {
            return json(400, { error: 'invalid_grant' });
          }
        } else {
          return json(400, { error: 'unsupported_grant_type' });
        }
        const refreshToken = `refresh-${++this.refreshCount}`;
        this.validRefreshTokens.add(refreshToken);
        return json(200, {
          access_token: fakeJwt({ vapi_user_id: 'user-1', vapi_org_id: 'org-1' }),
          refresh_token: refreshToken,
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((done) => this.server.listen(0, '127.0.0.1', done));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise((done) => this.server.close(done));
  }
}

let dir: string;
let credentialsFile: string;
let auth: FakeAuthServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vapi-mcp-auth-'));
  credentialsFile = join(dir, 'nested', 'credentials.json');
  auth = new FakeAuthServer();
  await auth.start();
});

afterEach(async () => {
  await auth.stop();
  await rm(dir, { recursive: true, force: true });
});

function savedCredentials(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  auth.validRefreshTokens.add('refresh-0');
  return {
    version: 1,
    issuer: auth.issuer,
    clientId: 'client_cli',
    audience: 'https://api.vapi.ai',
    refreshToken: 'refresh-0',
    accessToken: 'expired-access',
    accessTokenExpiresAt: Date.now() - 1000,
    ...overrides,
  };
}

describe('PKCE', () => {
  test('matches the RFC 7636 Appendix B example', () => {
    expect(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});

describe('oauthSettings', () => {
  test('names every missing variable', () => {
    expect(() => oauthSettings({})).toThrow(
      /VAPI_OAUTH_ISSUER, VAPI_OAUTH_CLIENT_ID, VAPI_OAUTH_AUDIENCE/
    );
  });

  test('rejects an issuer with a path and non-https remote URLs', () => {
    const base = { VAPI_OAUTH_CLIENT_ID: 'c', VAPI_OAUTH_AUDIENCE: 'https://api.vapi.ai' };
    expect(() => oauthSettings({ ...base, VAPI_OAUTH_ISSUER: 'https://auth.example.com/' })).toThrow(/origin/);
    expect(() => oauthSettings({ ...base, VAPI_OAUTH_ISSUER: 'http://auth.example.com' })).toThrow(/https/);
    expect(oauthSettings({ ...base, VAPI_OAUTH_ISSUER: 'https://auth.example.com' }).issuer).toBe(
      'https://auth.example.com'
    );
  });
});

describe('loopback receiver', () => {
  test('ignores a response with the wrong state, then accepts the right one', async () => {
    const receiver = await startLoopbackReceiver();
    try {
      expect(receiver.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const code = receiver.waitForCode('expected', 5000);
      const forged = await fetch(`${receiver.redirectUri}?code=evil&state=other`);
      expect(forged.status).toBe(400);
      const real = await fetch(`${receiver.redirectUri}?code=good&state=expected`);
      expect(real.status).toBe(200);
      await expect(code).resolves.toBe('good');
    } finally {
      receiver.close();
    }
  });

  test('reports a cancelled sign-in', async () => {
    const receiver = await startLoopbackReceiver();
    try {
      const cancelled = expect(receiver.waitForCode('s', 5000)).rejects.toThrow(
        'Vapi sign-in was cancelled.'
      );
      await fetch(`${receiver.redirectUri}?error=access_denied&state=s`);
      await cancelled;
    } finally {
      receiver.close();
    }
  });
});

describe('login', () => {
  test('runs authorization code + PKCE and saves owner-only credentials', async () => {
    let authorizeUrl: URL | undefined;
    const identity = await login({
      settings: { issuer: auth.issuer, clientId: 'client_cli', audience: 'https://api.vapi.ai' },
      path: credentialsFile,
      log: () => {},
      // Stands in for the browser: the user approves and WorkOS redirects back.
      openBrowser: (url) => {
        authorizeUrl = new URL(url);
        const params = authorizeUrl.searchParams;
        auth.challenges.set('the-code', params.get('code_challenge')!);
        void fetch(`${params.get('redirect_uri')}?code=the-code&state=${params.get('state')}`);
      },
    });

    const params = authorizeUrl!.searchParams;
    expect(authorizeUrl!.pathname).toBe('/oauth2/authorize');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe('client_cli');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('scope')).toBe('openid offline_access');
    expect(params.get('resource')).toBe('https://api.vapi.ai');
    expect(params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const tokenRequest = auth.tokenRequests[0];
    expect(tokenRequest.get('grant_type')).toBe('authorization_code');
    expect(tokenRequest.get('client_secret')).toBeNull();
    expect(tokenRequest.get('redirect_uri')).toBe(params.get('redirect_uri'));

    expect(identity).toEqual({ userId: 'user-1', orgId: 'org-1' });
    const saved = await readCredentials(credentialsFile);
    expect(saved).toMatchObject({ refreshToken: 'refresh-1', orgId: 'org-1', clientId: 'client_cli' });
    if (process.platform !== 'win32') {
      expect((await stat(credentialsFile)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(credentialsFile))).mode & 0o777).toBe(0o700);
    }
  });
});

describe('OAuthTokenProvider', () => {
  test('refreshes an expired token once for concurrent callers and saves the rotated refresh token', async () => {
    await writeCredentials(credentialsFile, savedCredentials());
    const provider = new OAuthTokenProvider({ path: credentialsFile });

    const tokens = await Promise.all([provider.getAccessToken(), provider.getAccessToken()]);
    expect(tokens[0]).toBe(tokens[1]);
    expect(auth.tokenRequests).toHaveLength(1);
    expect(auth.tokenRequests[0].get('resource')).toBe('https://api.vapi.ai');

    const saved = await readCredentials(credentialsFile);
    expect(saved?.refreshToken).toBe('refresh-1');
    expect(saved?.accessTokenExpiresAt).toBeGreaterThan(Date.now() + 3_000_000);

    // Still valid: no further network calls.
    await provider.getAccessToken();
    expect(auth.tokenRequests).toHaveLength(1);
  });

  test('uses a token another process already refreshed instead of reusing the old refresh token', async () => {
    await writeCredentials(
      credentialsFile,
      savedCredentials({ accessToken: 'fresh-from-other-process', accessTokenExpiresAt: Date.now() + 3_600_000 })
    );
    const provider = new OAuthTokenProvider({ path: credentialsFile });
    await expect(provider.getAccessToken()).resolves.toBe('fresh-from-other-process');
    expect(auth.tokenRequests).toHaveLength(0);
  });

  test('tells the user to sign in again when the refresh token is rejected', async () => {
    await writeCredentials(credentialsFile, savedCredentials({ refreshToken: 'revoked' }));
    const provider = new OAuthTokenProvider({ path: credentialsFile });
    await expect(provider.getAccessToken()).rejects.toThrow(
      'Your Vapi sign-in has expired or was revoked. Run `npx @vapi-ai/mcp-server login` to sign in again.'
    );
  });
});

describe('resolveVapiToken', () => {
  test('prefers VAPI_TOKEN, then saved sign-in, else asks the user to sign in', async () => {
    const env = { VAPI_MCP_CREDENTIALS_FILE: credentialsFile };
    await expect(resolveVapiToken({ ...env, VAPI_TOKEN: 'api-key' })).resolves.toBe('api-key');
    await expect(resolveVapiToken(env)).rejects.toThrow(/Not signed in to Vapi/);

    await writeCredentials(credentialsFile, savedCredentials());
    const token = await resolveVapiToken(env);
    expect(typeof token).toBe('function');
    await expect((token as () => Promise<string>)()).resolves.toContain('.');
  });

  test('rejects a corrupted credentials file with a recovery hint', async () => {
    await writeCredentials(credentialsFile, savedCredentials());
    await writeFile(credentialsFile, '{not json');
    await expect(resolveVapiToken({ VAPI_MCP_CREDENTIALS_FILE: credentialsFile })).rejects.toThrow(/logout/);
  });
});

// The hosted server imports `dist/tools/index.js`. Sign-in code (browser,
// loopback server, credential files) must never end up on that import path.
describe('tools entry point', () => {
  test('does not import the auth module', () => {
    const srcRoot = resolve(process.cwd(), 'src');
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        visit(resolve(dirname(file), match[1]).replace(/\.js$/, '.ts'));
      }
    };
    visit(join(srcRoot, 'tools', 'index.ts'));
    const authFiles = [...seen].filter((file) => file.startsWith(join(srcRoot, 'auth')));
    expect(seen.size).toBeGreaterThan(5);
    expect(authFiles).toEqual([]);
  });
});
