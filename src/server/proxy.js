// HTTP proxy server that forwards requests to the dev server, injects the bridge script
// into HTML responses, and serves internal routes (/__bridge.js, /__devtools).

import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';
import * as cheerio from 'cheerio';
import { isEntryPoint, test } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths to assets served on internal routes.
const BRIDGE_SCRIPT_PATH = path.resolve(__dirname, '../client/bridge.js');
const DEVTOOLS_DIR       = path.resolve(__dirname, '../devtools');

// Tab names in order — used during DevTools panel assembly.
const DEVTOOLS_TABS = ['device', 'console', 'touch', 'dom', 'camera'];

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the response Content-Type indicates an HTML document.
 *
 * @param {import('node:http').IncomingMessage} response - Incoming response from the dev server.
 * @returns {boolean}
 */
function isHtmlResponse(response) {
  const contentType = response.headers['content-type'] || '';
  return contentType.toLowerCase().includes('text/html');
}

/**
 * Injects the bridge script tag into the given HTML string.
 * Uses cheerio for robust DOM parsing — handles malformed HTML, missing </body>,
 * and </body> appearing in attribute values or script content (see TECHNICAL.md §5.2).
 *
 * @param {string} html - The full HTML document string.
 * @returns {string} The HTML with the bridge <script> tag appended to <body>.
 */
function injectBridgeScript(html) {
  const $ = cheerio.load(html);
  $('body').append('<script src="/__bridge.js"></script>');
  return $.html();
}

/**
 * Reads a file from disk and writes it to the HTTP response.
 * Sends a plain-text 500 if the file cannot be read.
 *
 * @param {string} filePath - Absolute path to the file to serve.
 * @param {string} contentType - MIME type for the Content-Type response header.
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function serveFile(filePath, contentType, res) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    console.log(`[proxy] Could not read internal file at ${filePath}: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('devmirror internal error: could not read file.');
  }
}

/**
 * Reads the bridge script from disk, substitutes the host and port placeholders,
 * and serves the result as JavaScript.
 *
 * The script source contains the literal tokens `__BRIDGE_HOST__` and
 * `__BRIDGE_PORT__` so it can be stored as a plain file with no build step.
 * This function replaces those tokens at serve time so each phone receives
 * the correct WebSocket address for this devmirror session.
 *
 * @param {string} lanIp - LAN IP address to substitute for __BRIDGE_HOST__.
 * @param {number} bridgePort - Bridge port to substitute for __BRIDGE_PORT__.
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function serveBridgeScript(lanIp, bridgePort, res) {
  try {
    const template = await fs.readFile(BRIDGE_SCRIPT_PATH, 'utf8');
    const script = template
      .replaceAll('__BRIDGE_HOST__', lanIp)
      .replaceAll('__BRIDGE_PORT__', String(bridgePort));
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(script);
  } catch (error) {
    console.log(`[proxy] Could not read bridge script: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('devmirror internal error: could not read bridge script.');
  }
}

/**
 * Assembles and serves the DevTools panel.
 *
 * Reads the shell HTML, the shared CSS, and each tab component's CSS and HTML
 * in parallel, then injects them via plain string replacement — no HTML parser
 * involved, so CSS content (including `>` selectors) is never mangled.
 *
 * Markers in index.html:
 *   <!-- __DEVTOOLS_CSS__ -->       replaced with a single <style> block
 *   <!-- __TAB_<name>__ -->         replaced with the tab's inner HTML
 *   __BRIDGE_PORT__                 replaced with the bridge port number
 *
 * @param {number} bridgePort - Bridge port to substitute for __BRIDGE_PORT__.
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function serveDevtoolsPanel(bridgePort, res) {
  try {
    const tabDir = (name) => path.join(DEVTOOLS_DIR, 'components', 'tabs', name);

    // Read the shell and all component files in parallel.
    const [shellHtml, coreCss, ...tabData] = await Promise.all([
      fs.readFile(path.join(DEVTOOLS_DIR, 'index.html'), 'utf8'),
      fs.readFile(path.join(DEVTOOLS_DIR, 'style.css'),  'utf8'),
      // Interleaved pairs: [css0, html0, css1, html1, ...]
      ...DEVTOOLS_TABS.flatMap((name) => [
        fs.readFile(path.join(tabDir(name), 'style.css'),  'utf8'),
        fs.readFile(path.join(tabDir(name), 'index.html'), 'utf8'),
      ]),
    ]);

    // Collect all CSS into one <style> block to minimise round-trips.
    const tabCssBlocks = DEVTOOLS_TABS.map((_, i) => tabData[i * 2]).filter((s) => s.trim());
    const styleBlock   = '<style>\n' + [coreCss, ...tabCssBlocks].join('\n') + '\n</style>';

    // Plain string replacement — safe for CSS content, no parser needed.
    let html = shellHtml.replace('<!-- __DEVTOOLS_CSS__ -->', styleBlock);

    DEVTOOLS_TABS.forEach(function (name, i) {
      html = html.replace('<!-- __TAB_' + name + '__ -->', tabData[i * 2 + 1]);
    });

    html = html.replaceAll('__BRIDGE_PORT__', String(bridgePort));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error) {
    console.log(`[proxy] Could not assemble DevTools panel: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('devmirror internal error: could not assemble DevTools panel.');
  }
}

// ---------------------------------------------------------------------------
// Request forwarding
// ---------------------------------------------------------------------------

/**
 * Forwards a single HTTP request to the dev server.
 *
 * - Rewrites Origin and Host headers so the dev server sees requests as local.
 * - Removes Accept-Encoding to ensure responses arrive uncompressed, which
 *   avoids needing to decompress before cheerio can inject the script tag.
 * - HTML responses are fully buffered, the bridge script tag is injected, then sent.
 * - All other responses are piped through unmodified (see TECHNICAL.md §5.3).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} options
 * @param {number} options.targetPort - Port the dev server is running on.
 * @param {boolean} options.useHttps - Whether the dev server uses HTTPS.
 * @returns {void}
 */
function forwardRequest(req, res, { targetPort, useHttps, targetHost, targetHttps }) {
  const targetProtocol = (targetHttps || useHttps) ? 'https' : 'http';

  const forwardHeaders = {
    ...req.headers,
    origin: `${targetProtocol}://${targetHost}:${targetPort}`,
    host: `${targetHost}:${targetPort}`,
    // Disable compression so we can safely inspect and inject into the response body.
    'accept-encoding': 'identity',
  };

  const requestOptions = {
    hostname: targetHost,
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: forwardHeaders,
    ...(targetHttps ? { rejectUnauthorized: false } : {}),
  };

  // Use the correct request function for the target protocol.
  const requestFn = (targetHttps || useHttps) ? https.request : http.request;

  const targetReq = requestFn(requestOptions, (targetRes) => {
    if (isHtmlResponse(targetRes)) {
      bufferAndInject(targetRes, res);
    } else {
      // Non-HTML: pipe through unmodified — no buffering overhead.
      res.writeHead(targetRes.statusCode, targetRes.headers);
      targetRes.pipe(res);
    }
  });

  targetReq.on('error', (error) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log(`[proxy] Dev server not reachable at ${targetHost}:${targetPort}.`);
      sendDevServerErrorPage(res, targetHost, targetPort);
    } else {
      console.log(`[proxy] Request error for ${req.url}: ${error.message}`);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy error. Check the [proxy] output in your terminal.');
    }
  });

  // Forward the full request body (needed for POST, PUT, etc.).
  req.pipe(targetReq);
}

/**
 * Buffers all chunks from the target response, injects the bridge script tag,
 * and writes the modified HTML to the client response.
 *
 * Removes Content-Encoding and replaces Transfer-Encoding with an exact
 * Content-Length so the client receives a well-formed response.
 *
 * @param {import('node:http').IncomingMessage} targetRes - Response stream from the dev server.
 * @param {import('node:http').ServerResponse} res - Response stream to the browser.
 * @returns {void}
 */
function bufferAndInject(targetRes, res) {
  const chunks = [];

  targetRes.on('data', (chunk) => chunks.push(chunk));

  targetRes.on('end', () => {
    const html = Buffer.concat(chunks).toString('utf8');
    const injected = injectBridgeScript(html);
    const body = Buffer.from(injected, 'utf8');

    // Strip compression and chunked-encoding headers — we now know the exact size.
    const { 'content-encoding': _enc, 'transfer-encoding': _te, ...headers } = targetRes.headers;

    res.writeHead(targetRes.statusCode, {
      ...headers,
      'content-length': body.length,
      'content-type': 'text/html; charset=utf-8',
    });
    res.end(body);
  });

  targetRes.on('error', (error) => {
    console.log(`[proxy] Error reading response body: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end('Proxy error: failed to read response body.');
  });
}

/**
 * Sends a human-readable HTML error page when the dev server cannot be reached.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} targetPort - The port devmirror was trying to connect to.
 * @returns {void}
 */
function sendDevServerErrorPage(res, targetHost, targetPort) {
  const isCustomHost = targetHost !== 'localhost';
  const errorLines = isCustomHost
    ? [
        `<p>devmirror: Could not connect to ${targetHost}:${targetPort}.</p>`,
        '<p>Is your dev server running and does this hostname resolve on your machine?</p>',
        '<p>Check your /etc/hosts file.</p>',
      ]
    : [`<p>devmirror: Could not connect to localhost:${targetPort}. Is your dev server running?</p>`];

  const body = [
    '<!DOCTYPE html>',
    '<html><head><title>devmirror — dev server unreachable</title></head>',
    '<body style="font-family: monospace; padding: 2rem;">',
    ...errorLines,
    '</body></html>',
  ].join('\n');

  res.writeHead(502, { 'Content-Type': 'text/html' });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts the HTTP proxy server.
 *
 * Uses http-proxy exclusively for WebSocket upgrade forwarding, which preserves
 * HMR. HTTP requests are forwarded with Node's built-in http/https modules to
 * allow full control over response buffering and HTML injection.
 *
 * @param {object} options
 * @param {number} options.targetPort - Port the dev server is running on.
 * @param {number} options.proxyPort - Port this proxy server will listen on.
 * @param {string} options.lanIp - LAN IP of the host machine, substituted into the bridge script at serve time.
 * @param {number} options.bridgePort - Bridge WebSocket port, substituted into the bridge script at serve time.
 * @param {boolean} options.useHttps - Whether the target dev server uses HTTPS.
 * @returns {Promise<{ server: import('node:http').Server, close: () => Promise<void> }>}
 */
export function startProxy({ targetPort, proxyPort, lanIp, bridgePort, useHttps, targetHost = 'localhost', targetHttps = false }) {
  return new Promise((resolve, reject) => {
    // A minimal http-proxy instance — used only for WebSocket upgrade proxying.
    // HTTP requests are handled directly to allow response body interception.
    const wsProxy = httpProxy.createProxyServer({
      secure: !targetHttps,
    });

    wsProxy.on('error', (error, _req, socket) => {
      console.log(`[proxy] WebSocket proxy error: ${error.message}`);
      // Destroy the socket so the browser doesn't hang on a failed HMR connection.
      socket.destroy();
    });

    const server = http.createServer(async (req, res) => {
      // Serve internal devmirror assets before proxying to the dev server.
      if (req.url === '/__bridge.js') {
        await serveBridgeScript(lanIp, bridgePort, res);
        return;
      }

      if (req.url === '/__devtools') {
        await serveDevtoolsPanel(bridgePort, res);
        return;
      }

      forwardRequest(req, res, { targetPort, useHttps, targetHost, targetHttps });
    });

    // Forward all WebSocket upgrade requests straight to the dev server.
    // The bridge runs on its own separate port — these upgrades are HMR only.
    server.on('upgrade', (req, socket, head) => {
      const wsProtocol = (targetHttps || useHttps) ? 'wss' : 'ws';
      const target = `${wsProtocol}://${targetHost}:${targetPort}`;

      wsProxy.ws(req, socket, head, { target }, (error) => {
        console.log(`[proxy] WebSocket upgrade failed for ${req.url}: ${error.message}`);
        socket.destroy();
      });
    });

    server.on('error', (error) => {
      console.log(`[proxy] Server error: ${error.message}`);
      reject(error);
    });

    server.once('listening', () => {
      console.log(`[proxy] Listening on port ${proxyPort}`);

      /**
       * Closes the proxy HTTP server and the internal WS proxy instance.
       *
       * @returns {Promise<void>}
       */
      function close() {
        return new Promise((resolveClose) => {
          wsProxy.close();
          server.close(() => resolveClose());
        });
      }

      resolve({ server, close });
    });

    server.listen(proxyPort);
  });
}

// ---------------------------------------------------------------------------
// Self-tests (run only when this file is executed directly)
// ---------------------------------------------------------------------------

if (isEntryPoint(import.meta.url)) {
  const BASE_PORT = 19800;

  /**
   * Spins up a minimal HTTP server to act as the "dev server" in tests.
   * Returns a close handle.
   *
   * @param {number} port
   * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
   * @returns {Promise<{ close: () => Promise<void> }>}
   */
  function createFakeDevServer(port, handler) {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(port, () => {
        resolve({
          close: () => new Promise((done) => server.close(done)),
        });
      });
    });
  }

  /**
   * Makes an HTTP GET request and returns status + body as a string.
   *
   * @param {string} url
   * @returns {Promise<{ status: number, body: string, headers: object }>}
   */
  function get(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      }).on('error', reject);
    });
  }

  console.log('\n[proxy] Running self-tests...\n');

  // Test 1 — startProxy resolves with { server, close }.
  await test('startProxy resolves with { server, close }', async () => {
    const { server, close } = await startProxy({
      targetPort: 3000,
      proxyPort: BASE_PORT,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });
    if (!server) throw new Error('Expected server to be defined');
    if (typeof close !== 'function') throw new Error('Expected close to be a function');
    await close();
  });

  // Test 2 — /__bridge.js is served with the correct Content-Type.
  await test('serves /__bridge.js with Content-Type: application/javascript', async () => {
    const { close } = await startProxy({
      targetPort: 3000,
      proxyPort: BASE_PORT + 1,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });
    const { status, headers } = await get(`http://localhost:${BASE_PORT + 1}/__bridge.js`);
    await close();
    if (status !== 200) throw new Error(`Expected status 200, got ${status}`);
    if (!headers['content-type'].includes('application/javascript')) {
      throw new Error(`Unexpected Content-Type: ${headers['content-type']}`);
    }
  });

  // Test 3 — /__devtools is served with the correct Content-Type.
  await test('serves /__devtools with Content-Type: text/html', async () => {
    const { close } = await startProxy({
      targetPort: 3000,
      proxyPort: BASE_PORT + 2,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });
    const { status, headers } = await get(`http://localhost:${BASE_PORT + 2}/__devtools`);
    await close();
    if (status !== 200) throw new Error(`Expected status 200, got ${status}`);
    if (!headers['content-type'].includes('text/html')) {
      throw new Error(`Unexpected Content-Type: ${headers['content-type']}`);
    }
  });

  // Test 4 — HTML responses have the bridge script tag injected.
  await test('injects /__bridge.js script tag into HTML responses', async () => {
    const fakeDevServer = await createFakeDevServer(BASE_PORT + 10, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Hello</h1></body></html>');
    });

    const { close } = await startProxy({
      targetPort: BASE_PORT + 10,
      proxyPort: BASE_PORT + 3,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });

    const { body } = await get(`http://localhost:${BASE_PORT + 3}/`);
    await close();
    await fakeDevServer.close();

    if (!body.includes('src="/__bridge.js"')) {
      throw new Error('Bridge script tag not found in proxied HTML response');
    }
  });

  // Test 5 — Non-HTML responses are passed through unmodified.
  await test('passes non-HTML responses through unmodified', async () => {
    const payload = JSON.stringify({ hello: 'world' });

    const fakeDevServer = await createFakeDevServer(BASE_PORT + 11, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
    });

    const { close } = await startProxy({
      targetPort: BASE_PORT + 11,
      proxyPort: BASE_PORT + 4,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });

    const { body } = await get(`http://localhost:${BASE_PORT + 4}/api/data`);
    await close();
    await fakeDevServer.close();

    if (body !== payload) throw new Error(`Body was modified: ${body}`);
  });

  // Test 6 — A 502 error page is returned when the dev server is not running.
  await test('returns a 502 error page when dev server is not reachable', async () => {
    const { close } = await startProxy({
      targetPort: 1, // Nothing is running on port 1.
      proxyPort: BASE_PORT + 5,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });

    const { status, body } = await get(`http://localhost:${BASE_PORT + 5}/`);
    await close();

    if (status !== 502) throw new Error(`Expected status 502, got ${status}`);
    if (!body.includes('Is your dev server running?')) {
      throw new Error('Error page does not contain expected message');
    }
  });

  // Test 7 — Origin and Host headers are rewritten before forwarding.
  await test('rewrites Origin and Host headers on forwarded requests', async () => {
    let capturedHeaders = null;

    const fakeDevServer = await createFakeDevServer(BASE_PORT + 12, (req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    const { close } = await startProxy({
      targetPort: BASE_PORT + 12,
      proxyPort: BASE_PORT + 6,
      lanIp: '127.0.0.1',
      bridgePort: 9000,
      useHttps: false,
    });

    await get(`http://localhost:${BASE_PORT + 6}/`);
    await close();
    await fakeDevServer.close();

    if (!capturedHeaders.host.includes(`localhost:${BASE_PORT + 12}`)) {
      throw new Error(`Unexpected Host header: ${capturedHeaders.host}`);
    }
  });

  console.log('\n[proxy] Self-tests complete.\n');
}
