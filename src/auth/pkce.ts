import { createHash, randomBytes } from 'node:crypto';

// RFC 7636. The verifier stays in this process; only its S256 challenge goes
// to the browser, so an intercepted authorization code cannot be redeemed.
export function createCodeVerifier(): string {
  // 32 random bytes -> 43 base64url characters (the RFC minimum).
  return randomBytes(32).toString('base64url');
}

export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function createState(): string {
  return randomBytes(16).toString('base64url');
}
