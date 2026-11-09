import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AuthError } from './errors.js';

// What `login` saves. The refresh token is the long-lived secret; the access
// token is cached so a fresh server process doesn't refresh on every start.
export interface StoredCredentials {
  version: 1;
  issuer: string;
  clientId: string;
  audience: string;
  refreshToken: string;
  accessToken?: string;
  // Epoch milliseconds.
  accessTokenExpiresAt?: number;
  userId?: string;
  orgId?: string;
}

export function credentialsPath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.VAPI_MCP_CREDENTIALS_FILE) {
    return env.VAPI_MCP_CREDENTIALS_FILE;
  }
  const base =
    platform === 'win32'
      ? env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'vapi-mcp', 'credentials.json');
}

function isStoredCredentials(value: unknown): value is StoredCredentials {
  const v = value as Partial<StoredCredentials> | null;
  return (
    !!v &&
    v.version === 1 &&
    typeof v.issuer === 'string' &&
    typeof v.clientId === 'string' &&
    typeof v.audience === 'string' &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken.length > 0
  );
}

export async function readCredentials(path: string): Promise<StoredCredentials | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new AuthError(`Could not read saved Vapi sign-in at ${path}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isStoredCredentials(parsed)) {
    throw new AuthError(
      `Saved Vapi sign-in at ${path} is unreadable. Run \`npx @vapi-ai/mcp-server logout\` and sign in again.`
    );
  }
  return parsed;
}

// Owner-only file in an owner-only directory, replaced atomically so a crash
// never leaves a half-written refresh token behind.
export async function writeCredentials(path: string, credentials: StoredCredentials) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmpPath = `${path}.${process.pid}.tmp`;
  const handle = await open(tmpPath, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(credentials, null, 2) + '\n', 'utf8');
  } finally {
    await handle.close();
  }
  // open() mode is masked by umask; make sure.
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, path);
}

export async function deleteCredentials(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 100;

// Refresh tokens rotate, so two server processes (say, two MCP clients) must
// not refresh with the same one. Callers re-read the file inside the lock and
// skip the refresh if another process already did it.
export async function withCredentialsLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
    const lockAge = await stat(lockPath).then(
      (s) => Date.now() - s.mtimeMs,
      () => 0
    );
    if (lockAge > LOCK_STALE_MS) {
      await rm(lockPath, { force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new AuthError('Timed out waiting for another Vapi MCP process to refresh sign-in.');
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  try {
    return await task();
  } finally {
    await rm(lockPath, { force: true });
  }
}
