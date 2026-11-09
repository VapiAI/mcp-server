// Errors whose message is safe to show the user (and the MCP client's model).
// Messages never include tokens, codes or upstream response bodies.
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const LOGIN_COMMAND = 'npx @vapi-ai/mcp-server login';

export function notSignedIn(): AuthError {
  return new AuthError(
    `Not signed in to Vapi. Run \`${LOGIN_COMMAND}\` to sign in, or set VAPI_TOKEN to a Vapi API key.`
  );
}

export function signInExpired(): AuthError {
  return new AuthError(
    `Your Vapi sign-in has expired or was revoked. Run \`${LOGIN_COMMAND}\` to sign in again.`
  );
}
