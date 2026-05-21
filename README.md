# dev-mirror

**Test your web app on a real phone -- instantly, over WiFi, with zero config.**

<p align="center">
  <img src="assets/logo_animated.svg" width="180" alt="dev-mirror" />
</p>

```sh
npx @samosa-code/dev-mirror -p 3000
```

<!-- demo gif -->

---

## The problem

You build on a laptop. Your users are on phones.

Browser DevTools "device emulation" is a lie -- it cannot reproduce real DPR, real touch mechanics, hardware rendering quirks, or the actual viewport a user sees. So you either skip real-device testing (and ship bugs) or you fight through one of these:

| Workaround | What's wrong with it |
|---|---|
| Chrome DevTools device emulation | Simulated, not real hardware |
| USB + `chrome://inspect` | Android only, needs ADB and a cable |
| ngrok / Cloudflare Tunnel | Routes traffic through external servers, adds latency, rate-limited on free plans |
| Manual CORS changes | Per-project, error-prone, often breaks other things |
| `vite-plugin-qrcode` | Vite only, no DevTools -- just a QR code |
| weinre | Abandoned since 2014 |

None of them give you a **real phone**, running **your actual app**, with the **laptop acting as a live DevTools panel** -- all over your local network, in under 30 seconds, without touching your project's code.

That is what dev-mirror does.

---

## How it works

```
  Your dev server        dev-mirror proxy         Phone browser
  localhost:3000   -->  192.168.x.x:9001   -->   opens proxied URL
                               |
                        WebSocket bridge (port 9000)
                               |
                        DevTools panel (laptop)
                        localhost:9001/__devtools
```

1. **Proxy** -- dev-mirror starts a transparent HTTP proxy in front of your dev server. All requests are forwarded; CORS and `Host` headers are rewritten automatically. HMR WebSocket connections pass through untouched.

2. **Script injection** -- for every HTML response, dev-mirror injects a small bridge script (`/__bridge.js`) before `</body>`. The script is vanilla JS, under 3 KB, zero dependencies.

3. **WebSocket bridge** -- the bridge script on the phone connects back to dev-mirror over a WebSocket. It forwards console output, touch events, DOM snapshots, network requests, and device info in real time.

4. **DevTools panel** -- a panel opens automatically in your laptop browser. It shows everything coming from the phone: device info, console logs, touch heatmap, network requests, and a live DOM inspector.

No account. No cloud. No config changes to your project. Zero telemetry.

---

## Quick start

**Prerequisites:** Node 18 or later. Phone and laptop on the same WiFi network.

### 1. Start your dev server

```sh
npm run dev          # Vite, Next.js, Create React App, etc.
                     # Assuming it starts on port 3000
```

### 2. In a second terminal, run dev-mirror

```sh
npx @samosa-code/dev-mirror -p 3000
```

dev-mirror prints three things:
- Your **LAN IP** (auto-detected)
- The **Phone URL** -- open this on your phone
- The **DevTools URL** -- opens automatically in your laptop browser

```
  devmirror v1.0.2

  ✓ Local IP:    192.168.1.42
  ✓ Proxying:    http://localhost:3000
  ✓ Phone URL:   http://192.168.1.42:9001
  ✓ DevTools:    http://localhost:9001/__devtools
```

### 3. Scan the QR code

Point your phone camera at the QR code printed in the terminal.
Your app opens on the phone, and the DevTools panel activates on the laptop.

### 4. Done

Tap, scroll, and interact on your phone. Watch the DevTools panel update in real time.

---

## CLI reference

```sh
npx @samosa-code/dev-mirror -p <port> [options]
```

| Flag | Default | Description |
|---|---|---|
| `-p, --port <port>` | **required** | Port your dev server is running on |
| `--proxy-port <port>` | `9001` | Port for the proxy server (auto-increments if taken) |
| `--bridge-port <port>` | `9000` | Port for the WebSocket bridge (auto-increments if taken) |
| `--https` | `false` | Target dev server uses HTTPS |
| `--target-host <hostname>` | `localhost` | Proxy to a custom local hostname instead of localhost |
| `--target-https` | `false` | Target uses HTTPS with a self-signed cert (disables cert verification) |
| `--no-qr` | `false` | Skip printing the QR code |
| `--no-open` | `false` | Do not auto-open DevTools in the browser |
| `--host <ip>` | auto | Override auto-detected LAN IP address |

### Terminal shortcuts

While dev-mirror is running, press these keys in the terminal:

| Key | Action |
|---|---|
| `h` | Show keyboard shortcuts |
| `f` | Show FAQ (common setup problems and fixes) |
| `q` | Re-print the QR code |
| `i` | Re-print DNS setup instructions (when `--target-host` is active) |
| `Ctrl+C` | Quit |

> `--tunnel` is planned for a future release -- for when your phone and laptop are on different networks (coffee shops, client offices). Until then both devices must be on the same WiFi.

---

## Custom hostnames & cookies

By default dev-mirror proxies to `localhost`. This works for most apps, but some backends set cookies scoped to a specific domain (e.g. `Domain=.uat.company.com`). When the phone browses via the LAN IP (`192.168.x.x`), those cookies are silently dropped and login breaks.

**The fix: `--target-host`**

```sh
npx @samosa-code/dev-mirror -p 5173 --target-host localdev.uat.company.com
```

This tells dev-mirror to rewrite `Host` and `Origin` headers so your backend sees requests as coming from `localdev.uat.company.com` -- the same domain it sets cookies for.

When run as **Administrator** (Windows) or **root** (macOS/Linux), dev-mirror also starts a lightweight DNS server on your LAN IP (port 53). Point your phone's WiFi DNS at your laptop's LAN IP, and the phone will resolve the custom hostname directly to the proxy -- no VPN, no cloud service, no hosts file on the phone.

```
  ✓ Proxying:    http://localdev.uat.company.com:5173
  ✓ Phone URL:   http://192.168.1.12:9001
  ✓ Custom URL:  http://localdev.uat.company.com:9001
  ✓ DNS server:  running on 192.168.1.12:53
```

Press `i` in the terminal to see step-by-step DNS setup instructions for Android and iPhone.

### Choosing a hostname

| Hostname type | Works? | Notes |
|---|---|---|
| Fake/nonexistent (e.g. `myapp.test`) | ✓ Best | No HSTS, no public DNS interference |
| Your own subdomain (e.g. `local.yourapp.com`) | ✓ Usually | Check it's not HSTS-preloaded |
| Real apex domains (e.g. `pasta.com`, `example.dev`) | ✗ | HSTS-preloaded — Chrome forces HTTPS, proxy only speaks HTTP |
| IP addresses | ✗ | Use `--host` instead |

> **Laptop hosts file:** dev-mirror automatically resolves the custom hostname to `127.0.0.1` inside the proxy process (no hosts file edit needed on the laptop).

### With HTTPS dev server

If your dev server uses a self-signed cert:

```sh
npx @samosa-code/dev-mirror -p 5173 --target-host myapp.test --target-https
```

This disables TLS certificate verification for the upstream connection only. The phone still browses over plain HTTP through the proxy.

---

## DevTools panel

The panel opens automatically at `http://localhost:<proxy-port>/__devtools`.

| Tab | What it shows |
|---|---|
| **Device** | Screen resolution, CSS viewport dimensions, device pixel ratio, OS, and full user agent string -- sourced from the real phone, not simulated. |
| **Console** | Every `console.log`, `console.warn`, and `console.error` call from the phone, streamed in real time. Filter by level, search by text, and toggle whether logs survive a page reload. |
| **Touch** | A heatmap canvas that visualises every `touchstart`, `touchmove`, and `touchend` event -- scaled to match the phone's exact screen aspect ratio. |
| **Network** | Every `fetch` and `XHR` request made by the phone. Filter by type (Fetch, XHR, JS, CSS, Errors), search by URL, and inspect request headers, response headers, response body, payload, and timing for each request. The sidebar is draggable. |
| **DOM** | On-demand HTML snapshot of the phone's live page. Browse a collapsible element tree, inspect attributes and matched CSS rules, search elements by tag / class / id / text, highlight an element on the phone with one click. |

> **Camera tab** is built but disabled in this release. Live camera feed from the phone is planned for a future version.

---

## Vite plugin

If you use Vite, skip the separate terminal entirely.

**Install:**

```sh
npm install --save-dev @samosa-code/dev-mirror
```

**`vite.config.js`:**

```js
import { defineConfig } from 'vite';
import devmirror from '@samosa-code/dev-mirror/vite';

export default defineConfig({
  plugins: [devmirror()],
});
```

dev-mirror starts automatically when you run `vite dev`. It reads the port Vite is already listening on -- no `-p` needed.

**Options:**

```js
devmirror({
  proxyPort:  9001,   // Port for the proxy server (default: 9001)
  bridgePort: 9000,   // Port for the WebSocket bridge (default: 9000)
  noQr:       false,  // Skip the QR code (default: false)
  host:       null,   // Override auto-detected LAN IP (default: auto)
})
```

---

## Requirements

- **Node.js 18 or later**
- **Same WiFi network** -- phone and laptop must be able to reach each other over LAN
- **Phone browser** -- Chrome for Android, Safari for iOS, Samsung Internet (any modern mobile browser)
- **DevTools panel** -- Chrome, Firefox, or Safari on the laptop (latest two versions)

If your router has **AP isolation** enabled (common on public/hotel WiFi), phone-to-laptop communication will be blocked. Use a personal hotspot, or wait for the `--tunnel` flag in a future release.

---

## DNS setup (phone)

When `--target-host` is set and dev-mirror is running as Administrator / root,
a DNS server starts on your laptop's LAN IP (port 53). Point your phone's WiFi
DNS at that IP once — the phone will then resolve the custom hostname to your
proxy automatically.

### Android

1. Settings → **WiFi** → long-press your network → **Modify network**
2. **Advanced options** → IP settings → **Static**
3. Set **DNS 1** to your laptop's LAN IP (shown in the dev-mirror startup output)
4. Set **DNS 2** to `8.8.8.8`
5. **Save**, then toggle WiFi off and back on

> **Private DNS must be Off.**  
> Settings → Network & Internet → **Private DNS** → **Off**  
> Android's Private DNS (DoH) overrides the WiFi DNS setting entirely. If it is
> set to anything other than Off, your custom DNS entry will be ignored.

### iPhone

1. Settings → **WiFi** → tap ⓘ next to your network
2. **Configure DNS** → **Manual**
3. Remove existing servers, add your laptop's LAN IP
4. **Save**, then toggle WiFi off and back on

### Verify it's working

From your laptop terminal:

```sh
nslookup <hostname> <laptop-LAN-IP>
# e.g. nslookup myapp.test 192.168.1.12
# Expected: Name: myapp.test   Address: 192.168.1.12
```

> Use `nslookup`, not PowerShell's `Resolve-DnsName`. PowerShell uses TCP by
> default; the dev-mirror DNS server is UDP-only.

---

## Troubleshooting

### Phone shows DNS_PROBE_FINISHED_NXDOMAIN

The phone is not using your laptop's DNS server.

1. **Toggle WiFi off and back on** — this flushes the DNS cache and forces the
   phone to re-query. This fixes most NXDOMAIN errors without any further steps.
2. Check **Private DNS is Off** (Android: Settings → Network & Internet → Private DNS → Off).
3. Re-check the WiFi DNS setting — some Android builds reset it on reconnect.
4. Verify the DNS server is answering: `nslookup <hostname> <laptop-LAN-IP>`

---

### Phone shows "Sent an invalid response" or ERR_SSL_PROTOCOL_ERROR

The hostname you chose is on Chrome's **HSTS preload list**. Chrome forces
`https://` for that domain before making any network request — the dev-mirror
proxy only speaks plain HTTP, so the connection fails.

**Fix:** use a hostname that doesn't exist in real DNS:

```sh
npx @samosa-code/dev-mirror -p 5173 --target-host myapp.test
```

Avoid real apex domains (`.com`, `.dev`, `.app`, `pasta.com`, etc.) — many are
HSTS-preloaded in Chrome. A fake subdomain like `myapp.test` or
`local.yourapp.com` is always safe.

---

### Proxy logs "Dev server not reachable at \<hostname\>:PORT"

The proxy runs on your laptop and needs to TCP-connect to the dev server using
the custom hostname. Your laptop's system DNS has no entry for it (only the
phone's DNS points at dev-mirror).

dev-mirror resolves this automatically in the proxy process — no hosts file
edit is needed. If you still see this error, make sure you are running the
latest version (`npx @samosa-code/dev-mirror@latest`).

---

### Windows Firewall blocks the DNS server

The DNS server starts successfully but the phone cannot resolve the hostname
(times out). Run this **once** in an elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "devmirror DNS" `
  -Direction Inbound -Protocol UDP -LocalPort 53 -Action Allow
```

---

### Vite rejects requests with 403

Vite's `allowedHosts` check blocks requests whose `Host` header is not
`localhost`. Add the hostname to your Vite config:

```js
// vite.config.js
export default {
  server: {
    host: true,
    allowedHosts: ['myapp.test'],
  },
}
```

---

### `Resolve-DnsName` fails but DNS is running

PowerShell's `Resolve-DnsName` uses TCP by default. dev-mirror's DNS server is
UDP-only. Use `nslookup` instead:

```sh
nslookup myapp.test 192.168.1.12
```

---

## How it's built

> This section is for developers evaluating the codebase or curious about the technical approach.

dev-mirror is a Node.js tool built entirely from standard npm packages -- no compiled binaries, no native modules, no build step required to run the source.

**Proxy server (`src/server/proxy.js`)** -- Built on [`http-proxy`](https://github.com/http-party/node-http-proxy). Buffers HTML responses, rewrites `Host` and `Origin` headers so same-origin API calls work on the phone without CORS config changes, injects the bridge script via [`cheerio`](https://cheerio.js.org/) before `</body>`, and passes WebSocket upgrade events through untouched to preserve HMR. When `--target-host` is set, a per-request `lookup` function resolves the custom hostname to `127.0.0.1` inside the process -- no hosts file edit needed on the laptop.

**WebSocket bridge (`src/server/bridge.js`)** -- A [`ws`](https://github.com/websockets/ws) WebSocket server that acts as a message router. Clients identify as `phone` or `devtools` on connect. Two allow-lists (`PHONE_TO_DEVTOOLS_TYPES`, `DEVTOOLS_TO_PHONE_TYPES`) control which message types can flow in each direction -- unknown or misrouted messages are silently dropped.

**DNS server (`src/server/dns.js`)** -- A minimal UDP DNS server (RFC 1035) built on Node's `dgram` module. Binds to the LAN IP (not `0.0.0.0`) to avoid conflicting with the OS DNS client. Answers A-record queries for the custom hostname with the LAN IP and forwards all other queries to 8.8.8.8. Only started when `--target-host` is set and the process has privilege to bind port 53.

**Phone bridge script (`src/client/bridge.js`)** -- Injected into every HTML page served through the proxy. Vanilla ES5-compatible JavaScript, no dependencies, under 3 KB. Patches `console.log/warn/error` to forward output over WebSocket, captures `touchstart/move/end` events with normalised coordinates, intercepts `fetch` and `XMLHttpRequest` to report network activity, responds to commands from the DevTools panel (`request_dom`, `highlight`, `request_styles`, `reload`), and handles reconnection automatically.

**DevTools panel (`src/devtools/`)** -- A self-contained HTML page assembled at serve-time from per-tab HTML, CSS, and JavaScript components. No framework, no bundler. The panel connects back to the bridge over WebSocket, drives a state machine (`waiting -> connected -> disconnected`), and updates all UI surfaces from a single `applyState()` call. The DOM tab uses `DOMParser` to parse the phone's `outerHTML` snapshot client-side and renders a virtual tree of `<div>` nodes -- no virtual DOM library.

**Key tradeoffs:**
- *Snapshot vs. live DOM*: the DOM tab shows a point-in-time snapshot rather than a live mirror. This avoids a continuous bidirectional sync protocol and keeps the bridge script tiny. The user clicks "Snapshot DOM" when they need a fresh view.
- *CSS styles via stylesheet walking*: matched CSS rules are collected on the phone by iterating `document.styleSheets` and testing each rule with `element.matches()`. Cross-origin stylesheets are skipped silently. This gives richer style data than `getComputedStyle()` alone (which loses selector information) without needing source maps.
- *No bundler*: the DevTools panel is assembled from raw files at request time. This keeps the dev loop instant and eliminates a build step from the publish path.

---

## What's coming

| Feature | Status |
|---|---|
| Camera feed from phone | Planned |
| `--tunnel` flag (works across networks) | Planned |
| Multi-device support | Planned |
| Next.js plugin | Planned |
| Performance metrics tab | Backlog |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT (c) Suraj Singh -- [samosa-code](https://github.com/samosa-code)
