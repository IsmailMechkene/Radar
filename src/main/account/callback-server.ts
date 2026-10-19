// Browser sign-ins and email links (Google, email confirmation, password reset) come back to Radar
// through a small HTTP server on the loopback address, as RFC 8252 recommends for native apps. It
// runs only while such a flow waits, answers only /auth/callback, and hands the one-time PKCE code
// to main; the code is useless without the verifier main keeps.
import { createServer, type Server } from 'node:http';

export const CALLBACK_HOST = '127.0.0.1';
export const CALLBACK_PORT = 47319;
export const CALLBACK_PATH = '/auth/callback';
export const CALLBACK_URL = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

export type CallbackResult = { code: string } | { error: string };

/**
 * What the browser tab shows; plain text in a tiny page, nothing from the URL echoed unescaped.
 * Its colors repeat --bg, --tx and --tx2 (tokens.css) since the page lives outside the app.
 */
function page(title: string, body: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 -apple-system,"Segoe UI",Inter,sans-serif;background:#F5F5F7;color:#1D1D1F;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:360px;padding:32px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#6E6E73;margin:0}
@media (prefers-color-scheme:dark){body{background:#1C1C1E;color:#F5F5F7}p{color:#A1A1A6}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body></html>`;
}

/** Reads the callback URL: a PKCE code, or the error the auth server reported. */
export function readCallback(url: string): CallbackResult | null {
  const u = new URL(url, `http://${CALLBACK_HOST}`);
  if (u.pathname !== CALLBACK_PATH) return null;
  const code = u.searchParams.get('code');
  if (code) return { code };
  const error = u.searchParams.get('error_description') ?? u.searchParams.get('error');
  return { error: error ? error.replace(/\+/g, ' ') : 'The sign-in link did not include a code' };
}

export interface CallbackServer {
  close(): Promise<void>;
}

/** Starts listening; `onResult` gets the first callback. Fails if the port is taken. */
export function startCallbackServer(
  onResult: (r: CallbackResult) => void,
  port = CALLBACK_PORT,
): Promise<CallbackServer> {
  let handled = false;
  const server: Server = createServer((req, res) => {
    const result = req.method === 'GET' && req.url ? readCallback(req.url) : null;
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ok = 'code' in result;
    res
      .writeHead(ok ? 200 : 400, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      .end(
        ok
          ? page(
              'You can go back to Radar',
              'Radar is finishing signing you in. You can close this tab.',
            )
          : page('Sign-in did not finish', `${result.error}. Go back to Radar and try again.`),
      );
    if (!handled) {
      handled = true;
      onResult(result);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) =>
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(
              `Port ${port} is in use by another program, so the sign-in cannot return to Radar`,
            )
          : err,
      ),
    );
    server.listen(port, CALLBACK_HOST, () =>
      resolve({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            // The browser keeps its connection alive; drop it so close() returns now.
            server.closeAllConnections();
          }),
      }),
    );
  });
}
