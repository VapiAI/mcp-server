import { oauthSettings } from './config.js';
import { notSignedIn } from './errors.js';
import { login } from './login.js';
import { credentialsPath, deleteCredentials, readCredentials } from './store.js';
import { OAuthTokenProvider } from './tokenProvider.js';
import type { VapiToken } from '../client.js';

// Credentials for the stdio server, in order: an explicit VAPI_TOKEN (API key,
// e.g. for CI), then the sign-in saved by `login`.
export async function resolveVapiToken(
  env: Record<string, string | undefined> = process.env
): Promise<VapiToken> {
  if (env.VAPI_TOKEN) {
    return env.VAPI_TOKEN;
  }
  const path = credentialsPath(env);
  if (!(await readCredentials(path))) {
    throw notSignedIn();
  }
  const provider = new OAuthTokenProvider({ path });
  return () => provider.getAccessToken();
}

// Commands print to stderr: stdout belongs to the MCP protocol when the same
// binary runs as a server.
export async function runLogin(): Promise<void> {
  const path = credentialsPath();
  const identity = await login({ settings: oauthSettings(), path });
  console.error(
    `Signed in to Vapi${identity.orgId ? ` (org ${identity.orgId})` : ''}. Credentials saved to ${path}.`
  );
}

export async function runLogout(): Promise<void> {
  const path = credentialsPath();
  const removed = await deleteCredentials(path);
  console.error(
    removed
      ? `Removed saved Vapi sign-in from ${path}. To revoke access entirely, remove the connection in your Vapi account.`
      : 'Not signed in to Vapi.'
  );
}

export async function runStatus(): Promise<void> {
  if (process.env.VAPI_TOKEN) {
    console.error('Using the API key in VAPI_TOKEN.');
    return;
  }
  const path = credentialsPath();
  const saved = await readCredentials(path);
  if (!saved) {
    throw notSignedIn();
  }
  console.error(
    [
      `Signed in to Vapi via ${saved.issuer}.`,
      saved.orgId ? `Org: ${saved.orgId}` : undefined,
      saved.userId ? `User: ${saved.userId}` : undefined,
      `Credentials: ${path}`,
    ]
      .filter(Boolean)
      .join('\n')
  );
}
