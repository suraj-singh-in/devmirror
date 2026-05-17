# devmirror

**Test your web app on a real phone â€” instantly, over WiFi, with zero config.**

```sh
npx dev-mirror -p 3000
```

<!-- demo gif -->

---

## The problem

You build on a laptop. Your users are on phones.

Browser DevTools "device emulation" is a lie â€” it can not reproduce real DPR, real touch mechanics, hardware rendering quirks, or the actual viewport a user sees. So you either skip real-device testing (and ship bugs) or you fight through one of these:

| Workaround | What's wrong with it |
|---|---|
| Chrome DevTools device emulation | Simulated, not real hardware |
| USB + `chrome://inspect` | Android only, needs ADB and a cable |
| ngrok / Cloudflare Tunnel | Routes traffic through external servers, adds latency, rate-limited on free plans |
| Manual CORS changes | Per-project, error-prone, often breaks other things |
| `vite-plugin-qrcode` | Vite only, no DevTools â€” just a QR code |
| weinre | Abandoned since 2014 |

None of them give you a **real phone**, running **your actual app**, with the **laptop acting as a live DevTools panel** â€” all over your local network, in under 30 seconds, without touching your project's code.

That is what devmirror does.

---

## How it works

```
  Your dev server          devmirror proxy          Phone browser
  localhost:3000    â†’    192.168.x.x:9001    â†’    opens proxied URL
                                â†• WebSocket bridge (port 9000)
                         DevTools panel (laptop)
                         localhost:9001/__devtools
```

1. **Proxy** â€” devmirror starts a transparent HTTP proxy in front of your dev server. All requests are forwarded; CORS and `Host` headers are rewritten automatically. HMR WebSocket connections pass through untouched.

2. **Script injection** â€” for every HTML response, devmirror injects a small bridge script (`/__bridge.js`) before `</body>`. The script is vanilla JS, under 3 KB, zero dependencies.

3. **WebSocket bridge** â€” the bridge script on the phone connects back to devmirror over a WebSocket. It forwards console output, touch events, DOM snapshots, and device info in real time.

4. **DevTools panel** â€” a panel opens automatically in your laptop browser. It shows everything coming from the phone: device info, console logs, touch heatmap, and a live DOM inspector.

No account. No cloud. No config changes to your project. Zero telemetry.

---

## Quick start

**Prerequisites:** Node 18 or later. Phone and laptop on the same WiFi network.

### 1. Start your dev server

```sh
npm run dev          # Vite, Next.js, Create React App, etc.
                     # Assuming it starts on port 3000
```

### 2. In a second terminal, run devmirror

```sh
npx dev-mirror -p 3000
```

devmirror prints three things:
- Your **LAN IP** (auto-detected)
- The **Phone URL** â€” open this on your phone
- The **DevTools URL** â€” opens automatically in your laptop browser

```
  devmirror v0.2.0

  âœ“ Local IP:    192.168.1.42
  âœ“ Proxying:    http://localhost:3000
  âœ“ Phone URL:   http://192.168.1.42:9001
  âœ“ DevTools:    http://localhost:9001/__devtools
```

### 3. Scan the QR code

Point your phone camera at the QR code printed in the terminal.  
Your app opens on the phone, and the DevTools panel activates on the laptop.

### 4. Done

Tap, scroll, and interact on your phone. Watch the DevTools panel update in real time.

---

## CLI reference

```sh
npx dev-mirror -p <port> [options]
```

| Flag | Default | Description |
|---|---|---|
| `-p, --port <port>` | **required** | Port your dev server is running on |
| `--proxy-port <port>` | `9001` | Port for the proxy server (auto-increments if taken) |
| `--bridge-port <port>` | `9000` | Port for the WebSocket bridge (auto-increments if taken) |
| `--https` | `false` | Target dev server uses HTTPS |
| `--no-qr` | `false` | Skip printing the QR code |
| `--no-open` | `false` | Do not auto-open DevTools in the browser |
| `--host <ip>` | auto | Override auto-detected LAN IP address |

> **`--tunnel` is planned for v1.0** â€” for when your phone and laptop are on different networks (coffee shops, client offices). Until then both devices must be on the same WiFi.

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

devmirror starts automatically when you run `vite dev`. It reads the port Vite is already listening on â€” no `-p` needed.

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

## DevTools panel

The panel opens automatically at `http://localhost:<proxy-port>/__devtools`.

| Tab | What it shows |
|---|---|
| **Device** | Screen resolution, CSS viewport dimensions, device pixel ratio, OS, and full user agent string â€” sourced from the real phone, not simulated. |
| **Console** | Every `console.log`, `console.warn`, and `console.error` call from the phone, streamed in real time. Filter by level, search by text, and toggle whether logs survive a page reload. |
| **Touch** | A heatmap canvas that visualises every `touchstart`, `touchmove`, and `touchend` event â€” scaled to match the phone's exact screen aspect ratio. |
| **DOM** | On-demand HTML snapshot of the phone's live page. Browse a collapsible element tree, inspect attributes and matched CSS rules, search elements by tag / class / id / text, highlight an element on the phone with one click. |

> **Camera tab** is built but disabled in this release. Live camera feed from the phone is planned for v0.4.

---

## Requirements

- **Node.js 18 or later**
- **Same WiFi network** â€” phone and laptop must be able to reach each other over LAN
- **Phone browser** â€” Chrome for Android, Safari for iOS, Samsung Internet (any modern mobile browser)
- **DevTools panel** â€” Chrome, Firefox, or Safari on the laptop (latest two versions)

If your router has **AP isolation** enabled (common on public/hotel WiFi), phone-to-laptop communication will be blocked. Use a hotspot, or wait for `--tunnel` in v1.0.

---

## How it's built

> This section is for developers evaluating the codebase or curious about the technical approach.

devmirror is a Node.js tool built entirely from standard npm packages â€” no compiled binaries, no native modules, no build step required to run the source.

**Proxy server (`src/server/proxy.js`)** â€” Built on [`http-proxy`](https://github.com/http-party/node-http-proxy). Buffers HTML responses, rewrites `Host` and `Origin` headers so same-origin API calls work on the phone without CORS config changes, injects the bridge script via [`cheerio`](https://cheerio.js.org/) before `</body>`, and passes WebSocket upgrade events through untouched to preserve HMR.

**WebSocket bridge (`src/server/bridge.js`)** â€” A [`ws`](https://github.com/websockets/ws) WebSocket server that acts as a message router. Clients identify as `phone` or `devtools` on connect. Two allow-lists (`PHONE_TO_DEVTOOLS_TYPES`, `DEVTOOLS_TO_PHONE_TYPES`) control which message types can flow in each direction â€” unknown or misrouted messages are silently dropped.

**Phone bridge script (`src/client/bridge.js`)** â€” Injected into every HTML page served through the proxy. Vanilla ES5-compatible JavaScript, no dependencies, under 3 KB. Patches `console.log/warn/error` to forward output over WebSocket, captures `touchstart/move/end` events with normalised coordinates, responds to commands from the DevTools panel (`request_dom`, `highlight`, `request_styles`, `reload`), and handles reconnection automatically.

**DevTools panel (`src/devtools/`)** â€” A self-contained HTML page assembled at serve-time from per-tab HTML, CSS, and JavaScript components. No framework, no bundler. The panel connects back to the bridge over WebSocket, drives a state machine (`waiting â†’ connected â†’ disconnected`), and updates all UI surfaces from a single `applyState()` call. The DOM tab uses `DOMParser` to parse the phone's `outerHTML` snapshot client-side and renders a virtual tree of `<div>` nodes â€” no virtual DOM library.

**Key tradeoffs:**
- *Snapshot vs. live DOM*: the DOM tab shows a point-in-time snapshot rather than a live mirror. This avoids a continuous bidirectional sync protocol and keeps the bridge script tiny. The user clicks "Snapshot DOM" when they need a fresh view.
- *CSS styles via stylesheet walking*: matched CSS rules are collected on the phone by iterating `document.styleSheets` and testing each rule with `element.matches()`. Cross-origin stylesheets are skipped silently. This gives richer style data than `getComputedStyle()` alone (which loses selector information) without needing source maps.
- *No bundler*: the DevTools panel is assembled from raw files at request time. This keeps the dev loop instant and eliminates a build step from the publish path.

---

## What's coming

| Feature | Version |
|---|---|
| Camera feed from phone | v0.4 |
| `--tunnel` flag (ngrok â€” works across networks) | v1.0 |
| Multi-device support | v1.0 |
| Next.js plugin | v0.5 |
| Network request inspector | backlog |
| Performance metrics tab | backlog |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT Â© Suraj Singh

