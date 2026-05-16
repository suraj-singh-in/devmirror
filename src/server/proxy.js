// HTTP proxy server that forwards requests to the dev server, injects the bridge script into HTML responses, and serves internal routes.

/**
 * Creates and starts the proxy server.
 *
 * Handles three categories of requests:
 *  - `/__bridge.js`: serves the bundled phone-side bridge script.
 *  - `/__devtools`: serves the DevTools panel HTML.
 *  - All other paths: forwarded to the dev server with rewritten Origin and Host headers.
 *    HTML responses are buffered, the bridge script tag is injected, then sent.
 *    Non-HTML responses are piped through unmodified.
 *
 * @param {object} options
 * @param {number} options.targetPort - Port the dev server is running on.
 * @param {number} options.proxyPort - Port this proxy server will listen on.
 * @param {number} options.bridgePort - Port the WebSocket bridge is listening on (injected into bridge script URL).
 * @param {string} options.lanIp - LAN IP address used to build the bridge script's WebSocket URL.
 * @param {boolean} options.useHttps - Whether the target dev server uses HTTPS.
 * @returns {Promise<import('node:http').Server>} The running HTTP server instance.
 */
export async function createProxyServer(options) {}
