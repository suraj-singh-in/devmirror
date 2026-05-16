// Phone-side bridge script injected into every HTML page served by the proxy.
// Connects to the WebSocket bridge, sends device info, patches console methods,
// forwards touch events, and handles incoming commands from the DevTools panel.
// Must stay <= 3KB minified. Zero external dependencies. Vanilla JS only.

/**
 * Initialises the bridge: connects to the WebSocket server, sends device info,
 * patches console methods, and attaches touch event listeners.
 *
 * Called immediately on script load via an IIFE in the bundled output.
 *
 * @param {string} lanIp - LAN IP address of the host machine (injected at build time).
 * @param {number} bridgePort - Port the WebSocket bridge is listening on (injected at build time).
 * @returns {void}
 */
export function initialiseBridge(lanIp, bridgePort) {}
