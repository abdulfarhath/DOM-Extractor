/**
 * Egress proxy. The browser is launched with every request, loopback
 * included, routed through this. Requests for the fixture are passed on;
 * anything else is written down and refused. What lands in `seen` is every
 * host the browser process tried to reach, whoever asked: a page, a content
 * script, the extension's worker, or the browser itself.
 */
import http from 'node:http';

/**
 * @param {{ fixturePort: number }} opts
 * @returns {Promise<{ url: string, port: number, seen: {host: string, method: string, url: string, allowed: boolean, at: number}[], close: () => Promise<void> }>}
 */
export async function startEgressProxy(opts) {
  /** @type {{host: string, method: string, url: string, allowed: boolean, at: number}[]} */
  const seen = [];
  const isFixture = (hostname, port) => (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') && Number(port) === opts.fixturePort;

  const server = http.createServer((req, res) => {
    let u;
    try {
      u = new URL(req.url || '');
    } catch {
      res.writeHead(400);
      return res.end('proxy: absolute URL expected');
    }
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const allowed = u.protocol === 'http:' && isFixture(u.hostname, port);
    seen.push({ host: u.host, method: req.method || 'GET', url: u.href.slice(0, 300), allowed, at: Date.now() });
    if (!allowed) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      return res.end('e2e harness: egress refused');
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const up = http.request({ host: '127.0.0.1', port: opts.fixturePort, method: req.method, path: u.pathname + u.search, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy: fixture unreachable: ${e.message}`);
    });
    req.pipe(up);
  });

  // HTTPS and anything else tunnelled: never the fixture, always refused.
  server.on('connect', (req, socket) => {
    seen.push({ host: String(req.url || ''), method: 'CONNECT', url: String(req.url || ''), allowed: false, at: Date.now() });
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  server.on('clientError', (_e, socket) => {
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch {
      /* gone */
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    seen,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      }),
  };
}
