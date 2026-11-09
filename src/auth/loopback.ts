import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AuthError } from './errors.js';

const CALLBACK_PATH = '/callback';

export interface LoopbackReceiver {
  redirectUri: string;
  // Resolves with the authorization code for this `state`.
  waitForCode(state: string, timeoutMs: number): Promise<string>;
  close(): void;
}

function page(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`;
}

// RFC 8252 loopback redirect: listens on 127.0.0.1 with an OS-assigned port
// for a single authorization response.
export async function startLoopbackReceiver(): Promise<LoopbackReceiver> {
  let expectedState: string | undefined;
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const send = (status: number, title: string, message: string) => {
      response.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(page(title, message));
    };

    // A response for some other login attempt (or a forged one): ignore it
    // and keep waiting for ours.
    if (!expectedState || url.searchParams.get('state') !== expectedState) {
      send(400, 'Sign-in not recognized', 'This sign-in response does not match the one in progress. Close this tab and try again.');
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      send(400, 'Sign-in was not completed', 'You can close this tab and run the login command again.');
      settle?.reject(
        new AuthError(
          error === 'access_denied'
            ? 'Vapi sign-in was cancelled.'
            : `Vapi sign-in failed (${error}).`
        )
      );
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      send(400, 'Sign-in was not completed', 'The response had no authorization code. Close this tab and try again.');
      return;
    }
    send(200, 'Signed in to Vapi', 'You can close this tab and return to your terminal.');
    settle?.resolve(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    waitForCode(state, timeoutMs) {
      expectedState = state;
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new AuthError('Timed out waiting for Vapi sign-in to finish in the browser.')),
          timeoutMs
        );
        settle = {
          resolve: (code) => {
            clearTimeout(timer);
            resolve(code);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
      });
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
