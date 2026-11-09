import { spawn } from 'node:child_process';

// Best effort: the caller always prints the URL too, for headless machines or
// when no browser opens. Arguments are passed without a shell.
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore: the URL is printed for the user to open by hand.
  }
}
