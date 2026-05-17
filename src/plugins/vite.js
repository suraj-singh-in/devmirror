// Vite plugin for devmirror.
// Importable as: import devmirror from 'devmirror/vite'
//
// Usage in vite.config.js:
//   import devmirror from 'devmirror/vite';
//   export default { plugins: [devmirror()] }

import pc from 'picocolors';
import qrcode from 'qrcode-terminal';

import { detectLanIp } from '../server/ip.js';
import { findFreePort } from '../server/ports.js';
import { startBridge } from '../server/bridge.js';
import { startProxy } from '../server/proxy.js';

// ---------------------------------------------------------------------------
// Output helpers — match CLI indent style (2-space indent per DESIGN.md §14).
// ---------------------------------------------------------------------------

const print        = (line)    => console.log(`  ${line}`);
const printBlank   = ()        => console.log('');
const printSuccess = (message) => print(`${pc.green('✓')} ${message}`);
const printWarning = (message) => print(`${pc.yellow('!')} ${message}`);

function printQrCode(url) {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (qrString) => {
      const lines      = qrString.split('\n').filter((l) => l.length > 0);
      const qrWidth    = Math.max(...lines.map((l) => l.length));
      const label      = 'Scan with your phone camera';
      const innerWidth = Math.max(qrWidth + 2, label.length + 4);
      const horizontal = '─'.repeat(innerWidth);
      const blankLine  = `  │${' '.repeat(innerWidth)}│`;
      const lPad       = Math.floor((innerWidth - label.length) / 2);
      const rPad       = innerWidth - label.length - lPad;
      const labelLine  = `${' '.repeat(lPad)}${label}${' '.repeat(rPad)}`;

      console.log(`  ┌${horizontal}┐`);
      console.log(blankLine);
      console.log(`  │${labelLine}│`);
      console.log(blankLine);
      lines.forEach((line) => {
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
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Vite plugin that starts a devmirror proxy + bridge alongside the dev server.
 *
 * @param {object} [options]
 * @param {number}  [options.proxyPort=9001]  - Port for the HTTP proxy server.
 * @param {number}  [options.bridgePort=9000] - Port for the WebSocket bridge.
 * @param {boolean} [options.noQr=false]      - Skip printing the QR code.
 * @param {string}  [options.host]            - Override auto-detected LAN IP.
 * @returns {import('vite').Plugin}
 */
export default function devmirrorPlugin(options = {}) {
  const {
    proxyPort:   wantedProxyPort  = 9001,
    bridgePort:  wantedBridgePort = 9000,
    noQr        = false,
    host        = null,
  } = options;

  let proxyServer  = null;
  let bridgeServer = null;

  return {
    name: 'devmirror',

    async configureServer(server) {
      // Vite's dev server port (defaults to 5173 when not configured).
      const targetPort = server.config.server.port ?? 5173;

      let lanIp;
      try {
        lanIp = await detectLanIp(host);
      } catch (err) {
        printWarning(`devmirror: could not detect LAN IP — ${err.message}`);
        printWarning('devmirror: pass { host: "192.168.x.x" } to the plugin to set it manually.');
        return;
      }

      const proxyPort  = await findFreePort(wantedProxyPort);
      const bridgePort = await findFreePort(wantedBridgePort);

      if (proxyPort !== wantedProxyPort) {
        printWarning(`devmirror: port ${wantedProxyPort} in use — using ${proxyPort} instead`);
      }
      if (bridgePort !== wantedBridgePort) {
        printWarning(`devmirror: port ${wantedBridgePort} in use — using ${bridgePort} instead`);
      }

      const phoneUrl    = `http://${lanIp}:${proxyPort}`;
      const devtoolsUrl = `http://localhost:${proxyPort}/__devtools`;

      proxyServer  = await startProxy({ targetPort, proxyPort, bridgePort, lanIp, useHttps: false });
      bridgeServer = await startBridge({ bridgePort });

      printBlank();
      print(`${pc.bold('devmirror')}`);
      printSuccess(`Phone URL:   ${phoneUrl}`);
      printSuccess(`DevTools:    ${devtoolsUrl}`);
      printBlank();

      if (!noQr) {
        await printQrCode(phoneUrl);
        printBlank();
      }

      // Tear down when Vite's HTTP server closes (e.g. Ctrl+C).
      server.httpServer?.on('close', () => {
        proxyServer?.close();
        bridgeServer?.close();
      });
    },
  };
}
