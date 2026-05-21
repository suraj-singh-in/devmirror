#!/usr/bin/env node

import { createRequire } from 'node:module';
import pc from 'picocolors';
import qrcode from 'qrcode-terminal';
import open from 'open';

import { detectLanIp } from '../src/server/ip.js';
import { findFreePort } from '../src/server/ports.js';
import { startBridge } from '../src/server/bridge.js';
import { startProxy } from '../src/server/proxy.js';
import { startDns, makeLocalLookup } from '../src/server/dns.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const DEFAULT_PROXY_PORT  = 9001;
const DEFAULT_BRIDGE_PORT = 9000;

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

const BANNER = [
  '  ██████╗ ███████╗██╗   ██╗    ███╗   ███╗██╗██████╗ ██████╗  ██████╗ ██████╗ ',
  '  ██╔══██╗██╔════╝██║   ██║    ████╗ ████║██║██╔══██╗██╔══██╗██╔═══██╗██╔══██╗',
  '  ██║  ██║█████╗  ██║   ██║    ██╔████╔██║██║██████╔╝██████╔╝██║   ██║██████╔╝',
  '  ██║  ██║██╔══╝  ╚██╗ ██╔╝    ██║╚██╔╝██║██║██╔══██╗██╔══██╗██║   ██║██╔══██╗',
  '  ██████╔╝███████╗ ╚████╔╝     ██║ ╚═╝ ██║██║██║  ██║██║  ██║╚██████╔╝██║  ██║',
  '  ╚═════╝ ╚══════╝  ╚═══╝      ╚═╝     ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝',
];

function printBanner() {
  if (!process.stdout.isTTY) return;
  console.log('');
  for (const line of BANNER) console.log(pc.cyan(line));
  console.log('');
  console.log(`  ${pc.red('♥')}  Made with Love by https://github.com/suraj-singh-in/`);
  console.log('     visit  http://notasecondhandlife.com/');
  console.log('');
}

// ---------------------------------------------------------------------------
// Sticky status line
// ---------------------------------------------------------------------------
// After startup we intercept process.stdout.write so every log line clears
// the status, prints the log, then redraws the status below it — giving a
// persistent one-line status at the bottom of the output.

let _statusText  = '';
let _rawWrite    = null;
let _inStatus    = false;

function activateStatusLine() {
  if (!process.stdout.isTTY) return;
  _rawWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = function (chunk, encoding, callback) {
    if (_inStatus) return _rawWrite(chunk, encoding, callback);
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }

    // Clear the status line before the new output lands.
    if (_statusText) _rawWrite('\r\x1b[K');

    _rawWrite(chunk, encoding);

    // Redraw status after writes that end with a newline (i.e. console.log).
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (_statusText && str.endsWith('\n')) {
      _inStatus = true;
      _rawWrite(_statusText);
      _inStatus = false;
    }

    if (typeof callback === 'function') callback();
    return true;
  };
}

function setStatus(text) {
  _statusText = text;
  if (!process.stdout.isTTY || !_rawWrite) return;
  _inStatus = true;
  _rawWrite('\r\x1b[K' + text);
  _inStatus = false;
}

// Temporarily suspend the status line so multi-line output (QR code, FAQ,
// help box) can print cleanly, then restore it afterwards.
async function withStatusSuspended(fn) {
  if (_rawWrite && _statusText) {
    _inStatus = true;
    _rawWrite('\r\x1b[K\n');
    _inStatus = false;
  }
  const saved = _statusText;
  _statusText = '';
  await fn();
  _statusText = saved;
  if (_rawWrite && saved) {
    _inStatus = true;
    _rawWrite(saved);
    _inStatus = false;
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const print      = (line) => console.log(`  ${line}`);
const printBlank = ()     => console.log('');
const printSuccess = (msg) => print(`${pc.green('✓')} ${msg}`);
const printWarning = (msg) => print(`${pc.yellow('!')} ${msg}`);

const printFatal = (message, hint) => {
  print(`${pc.red('✗')} ${message}`);
  if (hint) console.log(`      ${hint}`);
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const tokens = argv.slice(2);
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
    if      (token === '-p' || token === '--port')    options.port        = Number(tokens[++i]);
    else if (token === '--proxy-port')                options.proxyPort   = Number(tokens[++i]);
    else if (token === '--bridge-port')               options.bridgePort  = Number(tokens[++i]);
    else if (token === '--https')                     options.useHttps    = true;
    else if (token === '--no-qr')                     options.noQr        = true;
    else if (token === '--no-open')                   options.noOpen      = true;
    else if (token === '--host')                      options.host        = tokens[++i];
    else if (token === '--target-host')               options.targetHost  = tokens[++i];
    else if (token === '--target-https')              options.targetHttps = true;
  }
  return options;
}

function isValidPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

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
// QR code
// ---------------------------------------------------------------------------

function printQrCode(url) {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (qrString) => {
      const lines    = qrString.split('\n').filter((l) => l.length > 0);
      const qrWidth  = Math.max(...lines.map((l) => l.length));
      const label    = 'Scan with your phone camera';
      const innerWidth = Math.max(qrWidth + 2, label.length + 4);
      const horizontal = '─'.repeat(innerWidth);
      const blankLine  = `  │${' '.repeat(innerWidth)}│`;
      const lPad = Math.floor((innerWidth - label.length) / 2);
      const rPad = innerWidth - label.length - lPad;
      const labelLine = `${' '.repeat(lPad)}${label}${' '.repeat(rPad)}`;

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
// DNS setup box
// ---------------------------------------------------------------------------

function printDnsBox({ lanIp, targetHost, proxyPort }) {
  const customUrl = `http://${targetHost}:${proxyPort}`;
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const lines = [
    '',
    `  devmirror DNS is running. Point your phone at it once and`,
    `  cookies for ${targetHost} will work automatically.`,
    '',
    `  ${pc.bold('Android')}`,
    `    1. Settings → WiFi → long-press your network → Modify network`,
    `    2. Advanced options → IP settings → Static`,
    `    3. DNS 1 → ${lanIp}`,
    `    4. DNS 2 → 8.8.8.8`,
    `    5. Save`,
    '',
    `  ${pc.bold('iPhone')}`,
    `    1. Settings → WiFi → tap ⓘ next to your network`,
    `    2. Configure DNS → Manual`,
    `    3. Remove existing servers, add → ${lanIp}`,
    `    4. Save`,
    '',
    `  Then open on your phone:  ${pc.cyan(customUrl)}`,
    `  Or scan the QR code below ↓`,
    '',
  ];

  const innerWidth = Math.max(73, ...lines.map((l) => stripAnsi(l).length + 2));
  const title  = '─ Phone DNS setup ';
  const topBar = title + '─'.repeat(innerWidth - title.length);
  const botBar = '─'.repeat(innerWidth);

  console.log(`  ┌${topBar}┐`);
  for (const line of lines) {
    const visLen  = stripAnsi(line).length;
    const padding = ' '.repeat(innerWidth - visLen - 1);
    console.log(`  │ ${line}${padding}│`);
  }
  console.log(`  └${botBar}┘`);
}

// ---------------------------------------------------------------------------
// Help box  (press h)
// ---------------------------------------------------------------------------

function printHelp() {
  const rows = [
    ['h', 'Show this help'],
    ['f', 'Show FAQ'],
    ['q', 'Re-show QR code'],
    ['i', 'Re-show DNS instructions'],
    ['^C', 'Quit'],
  ];
  const innerWidth = 40;
  const hr = '─'.repeat(innerWidth);
  console.log(`  ┌─ Keyboard shortcuts ${'─'.repeat(innerWidth - 21)}┐`);
  console.log(`  │${' '.repeat(innerWidth)}│`);
  for (const [key, desc] of rows) {
    const keyStr  = pc.cyan(key.padEnd(4));
    const line    = `   ${keyStr}  ${desc}`;
    const visLen  = 3 + key.length + 2 + desc.length;
    const padding = ' '.repeat(innerWidth - visLen - 1);
    console.log(`  │ ${line}${padding}│`);
  }
  console.log(`  │${' '.repeat(innerWidth)}│`);
  console.log(`  └${hr}┘`);
}

// ---------------------------------------------------------------------------
// FAQ box  (press f)
// ---------------------------------------------------------------------------

function printFaq() {
  const W = 73; // inner width
  const hr = '─'.repeat(W);
  const blank = `  │${' '.repeat(W)}│`;

  const row = (text) => {
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const visLen  = stripAnsi(text).length;
    const padding = ' '.repeat(Math.max(0, W - visLen - 1));
    console.log(`  │ ${text}${padding}│`);
  };

  const section = (title) => {
    console.log(blank);
    row(pc.bold(pc.yellow(`▶  ${title}`)));
    console.log(blank);
  };

  console.log(`  ┌─ FAQ ${'─'.repeat(W - 6)}┐`);

  // §1
  section('Phone can\'t resolve the custom hostname');
  row('Symptoms: ERR_NAME_NOT_RESOLVED, DNS_PROBE_FINISHED_NXDOMAIN on phone.');
  console.log(blank);
  row('1. Android: Settings → Network & Internet → Private DNS → set to Off.');
  row('   (Private DNS / DoH overrides the WiFi DNS setting entirely.)');
  row('2. Forget and re-join WiFi after changing the DNS IP.');
  row('3. Verify from your laptop:  nslookup <hostname> <laptop-LAN-IP>');
  row('   (Use nslookup, not Resolve-DnsName — PowerShell uses TCP,');
  row('   devmirror DNS is UDP-only.)');
  console.log(blank);
  row(pc.green('💡 Quick fix: simply toggle WiFi off and back on — this flushes'));
  row('   the DNS cache and forces the phone to re-query your custom DNS.');
  row('   This resolves most NXDOMAIN errors without any further steps.');

  // §2
  section('"Sent an invalid response" on phone');
  row('Symptoms: Chrome shows "invalid response" or ERR_SSL_PROTOCOL_ERROR.');
  console.log(blank);
  row('The domain is on Chrome\'s HSTS preload list. Chrome forces HTTPS');
  row('before the request is made — the proxy only speaks plain HTTP.');
  console.log(blank);
  row('Fix: use a domain that doesn\'t exist in real DNS, e.g. myapp.test or');
  row('local.yourapp.com.  Avoid .dev, .app, and real apex domains like');
  row('pasta.com — these are HSTS-preloaded in Chrome.');

  // §3
  section('"Dev server not reachable" in proxy logs');
  row('Symptoms: [proxy] Dev server not reachable at <hostname>:PORT.');
  console.log(blank);
  row('The proxy runs on your laptop. Your laptop\'s system DNS has no entry');
  row('for the custom hostname (only the phone\'s DNS points at devmirror).');
  console.log(blank);
  row('Fix: add the hostname to your laptop\'s hosts file:');
  row('  Windows:    C:\\Windows\\System32\\drivers\\etc\\hosts');
  row('  macOS/Linux: /etc/hosts');
  row('  Add line:   127.0.0.1  <hostname>');

  // §4
  section('Windows Firewall blocks the DNS server');
  row('Symptoms: DNS starts (no EACCES), but phone can\'t resolve the hostname.');
  row('nslookup works from laptop; times out from phone.');
  console.log(blank);
  row('Fix (run once in an elevated PowerShell):');
  row('  New-NetFirewallRule -DisplayName "devmirror DNS" `');
  row('    -Direction Inbound -Protocol UDP -LocalPort 53 -Action Allow');

  // §5
  section('Vite rejects requests with 403');
  row('Symptoms: 403 Forbidden or Vite logs "request not allowed".');
  console.log(blank);
  row('Vite\'s allowedHosts check blocks requests whose Host header is not');
  row('localhost. Fix — add to vite.config.js:');
  row('  server: { host: true, allowedHosts: [\'<hostname>\'] }');

  // §6
  section('Resolve-DnsName fails but DNS is running');
  row('Symptoms: PowerShell\'s Resolve-DnsName returns WSAECONNRESET.');
  console.log(blank);
  row('PowerShell\'s Resolve-DnsName uses TCP by default. devmirror\'s DNS');
  row('server is UDP-only. Use nslookup instead:');
  row('  nslookup <hostname> <laptop-LAN-IP>');
  row('  Expected: Name: <hostname>  Address: <laptop-LAN-IP>');

  console.log(blank);
  console.log(`  └${hr}┘`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  printBanner();

  const options = parseArgs(process.argv);

  if (options.port === null) {
    exitWithUsage('-p / --port is required. Specify the port your dev server is running on.');
  }
  if (!isValidPort(options.port)) {
    exitWithUsage(`Invalid port: ${options.port}. Port must be a number between 1 and 65535.`);
  }

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

  let lanIp;
  try {
    lanIp = await detectLanIp(options.host ?? null);
  } catch (error) {
    if (error.message.includes('Could not detect a LAN IP address')) {
      printFatal(
        'Could not detect a LAN IP address.',
        'Connect to a WiFi network or pass one manually: --host 192.168.x.x',
      );
    } else {
      printFatal(error.message.replace(/^\[ip\]\s*/, ''));
    }
    process.exit(1);
  }

  printSuccess(`Local IP:    ${lanIp}`);

  const proxyPort = await findFreePort(options.proxyPort);
  if (proxyPort !== options.proxyPort) {
    printWarning(`Port ${options.proxyPort} in use — using ${proxyPort} instead`);
  }

  const bridgePort = await findFreePort(options.bridgePort);
  if (bridgePort !== options.bridgePort) {
    printWarning(`Port ${options.bridgePort} in use — using ${bridgePort} instead`);
  }

  const targetHost     = options.targetHost ?? 'localhost';
  const targetProtocol = (options.targetHttps || options.useHttps) ? 'https' : 'http';
  const phoneUrl       = `http://${lanIp}:${proxyPort}`;
  const devtoolsUrl    = `http://localhost:${proxyPort}/__devtools`;
  const localLookup    = options.targetHost !== null ? makeLocalLookup(targetHost) : null;

  let dnsServer = null;
  let dnsActive = false;
  if (options.targetHost !== null) {
    try {
      dnsServer = await startDns({ hostname: targetHost, address: lanIp });
      dnsActive = true;
    } catch (err) {
      if (err.code !== 'EACCES' && err.code !== 'EADDRINUSE') throw err;
    }
  }

  if (options.targetHttps) {
    printWarning('--target-https: TLS certificate verification is disabled for the proxy target.');
  }
  const certNote = options.targetHttps ? '  (cert verification off)' : '';
  printSuccess(`Proxying:    ${targetProtocol}://${targetHost}:${options.port}${certNote}`);
  printSuccess(`Phone URL:   ${phoneUrl}`);
  if (dnsActive) printSuccess(`Custom URL:  http://${targetHost}:${proxyPort}`);
  printSuccess(`DevTools:    ${devtoolsUrl}`);
  if (dnsActive) {
    printSuccess(`DNS server:  running on ${lanIp}:53`);
  } else if (options.targetHost !== null) {
    printWarning('DNS server could not start (run as Administrator to enable cookie-domain support).');
  }
  printBlank();

  // Device state for status line.
  let deviceInfo = null; // null | object | 'disconnected'

  const buildStatusLine = () => {
    const dot = deviceInfo && deviceInfo !== 'disconnected' ? pc.green('●') : pc.dim('◉');
    let label;
    if (!deviceInfo) {
      label = pc.dim('No device connected');
    } else if (deviceInfo === 'disconnected') {
      label = pc.dim('Disconnected');
    } else {
      const { width, height, devicePixelRatio: dpr } = deviceInfo;
      const dprStr = dpr ? ` · ${dpr}×` : '';
      label = `${pc.green('1 device')}  ${pc.dim('│')}  ${width} × ${height}${dprStr}`;
    }
    const ports = `${pc.dim('proxy')} :${proxyPort}  ${pc.dim('│')}  ${pc.dim('bridge')} :${bridgePort}`;
    return `  ${dot} ${label}  ${pc.dim('│')}  ${ports}`;
  };

  const proxy = await startProxy({
    targetPort: options.port,
    proxyPort,
    bridgePort,
    lanIp,
    useHttps: options.useHttps,
    targetHost,
    targetHttps: options.targetHttps,
    localLookup,
  });

  const bridge = await startBridge({
    bridgePort,
    onDeviceUpdate: (info) => {
      deviceInfo = info;
      setStatus(buildStatusLine());
    },
    onDeviceDisconnect: () => {
      deviceInfo = 'disconnected';
      setStatus(buildStatusLine());
    },
  });

  // DNS setup box + QR.
  if (dnsActive) {
    printDnsBox({ lanIp, targetHost, proxyPort });
    printBlank();
  }

  const qrUrl = dnsActive ? `http://${targetHost}:${proxyPort}` : phoneUrl;

  if (!options.noQr) {
    await printQrCode(qrUrl);
    printBlank();
  }

  // Activate sticky status line and draw the initial status.
  activateStatusLine();
  if (process.stdin.isTTY) {
    print(pc.dim('Press h for help'));
    printBlank();
  }
  setStatus(buildStatusLine());

  // Open DevTools in browser.
  if (!options.noOpen) {
    try {
      await open(devtoolsUrl);
    } catch {
      printWarning(`Could not auto-open browser. Open manually: ${devtoolsUrl}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  function shutdown() {
    // Write a clean newline past the status line before shutting down.
    if (_rawWrite && _statusText) _rawWrite('\r\x1b[K\n');
    printBlank();
    print('Shutting down...');
    proxy.close();
    bridge.close();
    if (dnsServer) dnsServer.close();
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // Keypress handler
  // ---------------------------------------------------------------------------

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key) => {
      if (key === '') {
        // Ctrl+C
        shutdown();
      } else if (key === 'h') {
        withStatusSuspended(() => {
          printBlank();
          printHelp();
          printBlank();
        });
      } else if (key === 'f') {
        withStatusSuspended(() => {
          printBlank();
          printFaq();
          printBlank();
        });
      } else if (key === 'q') {
        withStatusSuspended(async () => {
          printBlank();
          await printQrCode(qrUrl);
          printBlank();
        });
      } else if (key === 'i') {
        withStatusSuspended(() => {
          printBlank();
          if (dnsActive) {
            printDnsBox({ lanIp, targetHost, proxyPort });
          } else if (options.targetHost !== null) {
            print(pc.dim('DNS instructions: DNS server is not running (requires Administrator).'));
          } else {
            print(pc.dim('DNS instructions: not available (--target-host not set).'));
          }
          printBlank();
        });
      }
    });

    // Raw mode swallows SIGINT — only SIGTERM needs registering.
    process.on('SIGTERM', shutdown);
  } else {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

main().catch((error) => {
  printFatal(`Unexpected error: ${error.message}`);
  process.exit(1);
});
