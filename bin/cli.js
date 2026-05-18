#!/usr/bin/env node

/**
 * Entry point for `npx devmirror`.
 *
 * Orchestrates startup in order:
 *  1. Parse CLI arguments.
 *  2. Validate required flags.
 *  3. Resolve LAN IP via detectLanIp.
 *  4. Find free ports for proxy and bridge (auto-increment on collision).
 *  5. Print startup summary.
 *  6. Start proxy and bridge servers.
 *  7. Print QR code (unless --no-qr).
 *  8. Open DevTools panel in browser (unless --no-open).
 *  9. Register SIGINT / SIGTERM handlers for clean shutdown.
 */

import { createRequire } from 'node:module';
import pc from 'picocolors';
import qrcode from 'qrcode-terminal';
import open from 'open';

import { detectLanIp } from '../src/server/ip.js';
import { findFreePort } from '../src/server/ports.js';
import { startBridge } from '../src/server/bridge.js';
import { startProxy } from '../src/server/proxy.js';

// Read version from package.json without a build step.
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const DEFAULT_PROXY_PORT = 9001;
const DEFAULT_BRIDGE_PORT = 9000;

// ---------------------------------------------------------------------------
// Output helpers — all output indented by 2 spaces per DESIGN.md §14.
// ---------------------------------------------------------------------------

/** Prints a line with the standard 2-space indent. */
const print = (line) => console.log(`  ${line}`);

/** Prints an empty line (no indent needed for blank lines). */
const printBlank = () => console.log('');

/** Prints a ✓ success line in green. */
const printSuccess = (message) => print(`${pc.green('✓')} ${message}`);

/** Prints a ! warning line in yellow. */
const printWarning = (message) => print(`${pc.yellow('!')} ${message}`);

/**
 * Prints a ✗ fatal error line in red, with an optional hint on the next line.
 * The hint is indented 6 spaces (4 past the base 2-space indent) per DESIGN.md §14.
 *
 * @param {string} message - The main error description.
 * @param {string} [hint] - An actionable follow-up step for the user.
 */
const printFatal = (message, hint) => {
  print(`${pc.red('✗')} ${message}`);
  if (hint) console.log(`      ${hint}`);
};

// ---------------------------------------------------------------------------
// Argument parsing.
// ---------------------------------------------------------------------------

/**
 * Parses process.argv into a structured options object.
 * Uses no external library — iterates tokens manually.
 *
 * @param {string[]} argv - The raw process.argv array.
 * @returns {{
 *   port: number | null,
 *   proxyPort: number,
 *   bridgePort: number,
 *   useHttps: boolean,
 *   noQr: boolean,
 *   noOpen: boolean,
 *   host: string | null,
 *   targetHost: string | null,
 *   targetHttps: boolean,
 * }}
 */
function parseArgs(argv) {
  const tokens = argv.slice(2); // Skip the node binary path and script path.
  const options = {
    port: null,
    proxyPort: DEFAULT_PROXY_PORT,
    bridgePort: DEFAULT_BRIDGE_PORT,
    useHttps: false,
    noQr: false,
    noOpen: false,
    host: null,
    targetHost: null,
    targetHttps: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-p' || token === '--port') {
      options.port = Number(tokens[++i]);
    } else if (token === '--proxy-port') {
      options.proxyPort = Number(tokens[++i]);
    } else if (token === '--bridge-port') {
      options.bridgePort = Number(tokens[++i]);
    } else if (token === '--https') {
      options.useHttps = true;
    } else if (token === '--no-qr') {
      options.noQr = true;
    } else if (token === '--no-open') {
      options.noOpen = true;
    } else if (token === '--host') {
      options.host = tokens[++i];
    } else if (token === '--target-host') {
      options.targetHost = tokens[++i];
    } else if (token === '--target-https') {
      options.targetHttps = true;
    }
  }

  return options;
}

/**
 * Returns true if the given value is a valid port number (integer, 1–65535).
 *
 * @param {number} value
 * @returns {boolean}
 */
function isValidPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * Prints usage instructions with a fatal error prefix, then exits with code 1.
 *
 * @param {string} reason - Why the usage is being shown.
 * @returns {never}
 */
function exitWithUsage(reason) {
  printFatal(reason);
  printBlank();
  print('Usage:  npx devmirror -p <port> [options]');
  printBlank();
  print('  -p, --port <port>        Port your dev server is running on (required)');
  print('  --proxy-port <port>      Proxy server port (default: 9001)');
  print('  --bridge-port <port>     WebSocket bridge port (default: 9000)');
  print('  --https                  Target dev server uses HTTPS');
  print('  --target-host <hostname> Proxy to a custom local hostname (default: localhost)');
  print('  --target-https           Target uses HTTPS with self-signed cert (skips cert verification)');
  print('  --no-qr                  Skip printing the QR code');
  print('  --no-open                Do not auto-open DevTools in browser');
  print('  --host <ip>              Override detected LAN IP address');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// QR code.
// ---------------------------------------------------------------------------

/**
 * Prints the QR code for the given URL inside a labelled box.
 *
 * Captures the QR string via qrcode-terminal's callback form (when a callback
 * is provided, the library does not print to stdout — it passes the string).
 *
 * @param {string} url - The phone URL to encode.
 * @returns {Promise<void>}
 */
function printQrCode(url) {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (qrString) => {
      const lines = qrString.split('\n').filter((line) => line.length > 0);
      const qrWidth = Math.max(...lines.map((line) => line.length));
      const label = 'Scan with your phone camera';

      // Inner width accommodates the QR code (with 2-space left indent inside box)
      // and the label (with 2 spaces each side). Take whichever is wider.
      const innerWidth = Math.max(qrWidth + 2, label.length + 4);
      const horizontal = '─'.repeat(innerWidth);
      const blankLine = `  │${' '.repeat(innerWidth)}│`;

      // Centre the label within innerWidth.
      const labelLeftPad = Math.floor((innerWidth - label.length) / 2);
      const labelRightPad = innerWidth - label.length - labelLeftPad;
      const labelLine = `${' '.repeat(labelLeftPad)}${label}${' '.repeat(labelRightPad)}`;

      console.log(`  ┌${horizontal}┐`);
      console.log(blankLine);
      console.log(`  │${labelLine}│`);
      console.log(blankLine);
      lines.forEach((line) => {
        // 2-space left indent inside box; right-pad to fill innerWidth.
        const padded = `  ${line}${' '.repeat(innerWidth - line.length - 2)}`;
        console.log(`  │${padded}│`);
      });
      console.log(blankLine);
      console.log(`  └${horizontal}┘`);

      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

/**
 * Main entry point. Validates args, resolves network config, starts servers,
 * and registers shutdown handlers.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const options = parseArgs(process.argv);

  // Validate -p / --port before doing anything else.
  if (options.port === null) {
    exitWithUsage('-p / --port is required. Specify the port your dev server is running on.');
  }
  if (!isValidPort(options.port)) {
    exitWithUsage(
      `Invalid port: ${options.port}. Port must be a number between 1 and 65535.`,
    );
  }

  // Validate --target-host if provided.
  if (options.targetHost !== null) {
    const protocolMatch = options.targetHost.match(/^https?:\/\//);
    if (protocolMatch) {
      options.targetHost = options.targetHost.replace(/^https?:\/\//, '');
      printWarning(`--target-host should be a hostname only, not a URL. Using: ${options.targetHost}`);
    }
    if (/^(192\.|10\.|172\.)/.test(options.targetHost)) {
      printFatal('--target-host is for custom local domain names, not IP addresses. Use --host for IP overrides.');
      process.exit(1);
    }
  }

  print(`devmirror v${version}`);
  printBlank();

  // Resolve LAN IP — may prompt the user if multiple interfaces are found.
  let lanIp;
  try {
    lanIp = await detectLanIp(options.host ?? null);
  } catch (error) {
    // The zero-candidates error has a specific message and hint per DESIGN.md §14.
    if (error.message.includes('Could not detect a LAN IP address')) {
      printFatal(
        'Could not detect a LAN IP address.',
        'Connect to a WiFi network or pass one manually: --host 192.168.x.x',
      );
    } else {
      // Strip the internal [ip] prefix before showing to the user.
      printFatal(error.message.replace(/^\[ip\]\s*/, ''));
    }
    process.exit(1);
  }

  printSuccess(`Local IP:    ${lanIp}`);

  // Find free ports — print a warning if either default was already taken.
  const proxyPort = await findFreePort(options.proxyPort);
  if (proxyPort !== options.proxyPort) {
    printWarning(`Port ${options.proxyPort} in use — using ${proxyPort} instead`);
  }

  const bridgePort = await findFreePort(options.bridgePort);
  if (bridgePort !== options.bridgePort) {
    printWarning(`Port ${options.bridgePort} in use — using ${bridgePort} instead`);
  }

  const targetHost = options.targetHost ?? 'localhost';
  const targetProtocol = (options.targetHttps || options.useHttps) ? 'https' : 'http';
  const phoneUrl = `http://${lanIp}:${proxyPort}`;
  const devtoolsUrl = `http://localhost:${proxyPort}/__devtools`;

  if (options.targetHttps) {
    printWarning('--target-https: TLS certificate verification is disabled for the proxy target.');
  }
  const certNote = options.targetHttps ? '  (cert verification off)' : '';
  printSuccess(`Proxying:    ${targetProtocol}://${targetHost}:${options.port}${certNote}`);
  printSuccess(`Phone URL:   ${phoneUrl}`);
  printSuccess(`DevTools:    ${devtoolsUrl}`);
  printBlank();

  const proxy = await startProxy({
    targetPort: options.port,
    proxyPort,
    bridgePort,
    lanIp,
    useHttps: options.useHttps,
    targetHost,
    targetHttps: options.targetHttps,
  });
  const bridge = await startBridge({ bridgePort });

  // QR code (skipped if --no-qr).
  if (!options.noQr) {
    await printQrCode(phoneUrl);
    printBlank();
  }

  print(`${pc.white('◉')} Waiting for phone...`);

  // Open DevTools in the default browser (skipped if --no-open).
  if (!options.noOpen) {
    try {
      await open(devtoolsUrl);
    } catch {
      // Non-fatal — the URL is already printed; the user can open it manually.
      printWarning(`Could not auto-open browser. Open manually: ${devtoolsUrl}`);
    }
  }

  // Clean shutdown on CTRL+C or SIGTERM — close servers before exiting.
  function shutdown() {
    printBlank();
    print('Shutting down...');
    proxy.close();
    bridge.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  printFatal(`Unexpected error: ${error.message}`);
  process.exit(1);
});
