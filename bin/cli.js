#!/usr/bin/env node

/**
 * Entry point for `npx devmirror`.
 *
 * Orchestrates startup in order:
 *  1. Parse CLI arguments.
 *  2. Detect LAN IP.
 *  3. Find free ports for proxy and bridge.
 *  4. Start proxy server.
 *  5. Start WebSocket bridge server.
 *  6. Print QR code and terminal summary.
 *  7. Open DevTools panel in browser.
 *  8. Register SIGINT / SIGTERM handlers for clean shutdown.
 */

import { detectLanIp } from '../src/server/ip.js';
import { createProxyServer } from '../src/server/proxy.js';
import { createBridgeServer } from '../src/server/bridge.js';
import { findFreePort } from '../src/server/ports.js';

console.log('[cli] devmirror starting...');
