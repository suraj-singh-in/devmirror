# Dev Mirror

## 1. Overview

### 1.1 Problem Statement

Frontend developers cannot easily test their local development server on a real physical device. Existing solutions require cables, cloud accounts, manual CORS configuration, or are framework-specific. The result is that most developers either skip real-device testing entirely or accept significant friction to do it.

### 1.2 Proposed Solution

A zero-config CLI tool (`npx devmirror -p <port>`) that:

1. Detects the machine's LAN IP address automatically
2. Starts a transparent proxy server wrapping the developer's app
3. Injects a lightweight bridge script into every HTML response
4. Displays a QR code in the terminal pointing to the proxied URL
5. Opens a DevTools panel in the laptop browser showing real-time data from the phone

## Usage

### CLI

```sh
npx devmirror -p 3000
```

Run alongside any dev server listening on port 3000. The phone URL and a QR code are printed in the terminal. Open the DevTools URL on your laptop to inspect the phone.

**Options**

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <port>` | — | Port your dev server is running on **(required)** |
| `--proxy-port <port>` | 9001 | Port for the proxy server |
| `--bridge-port <port>` | 9000 | Port for the WebSocket bridge |
| `--https` | false | Target dev server uses HTTPS |
| `--no-qr` | false | Skip printing the QR code |
| `--no-open` | false | Do not auto-open DevTools in browser |
| `--host <ip>` | auto | Override detected LAN IP address |

### Vite plugin

If you use Vite, you can integrate devmirror directly into your dev server instead of running it as a separate CLI process.

**Install**

```sh
npm install --save-dev devmirror
```

**`vite.config.js`**

```js
import { defineConfig } from 'vite';
import devmirror from 'devmirror/vite';

export default defineConfig({
  plugins: [devmirror()],
});
```

The plugin starts automatically when you run `vite` (or `vite dev`). It reads the port Vite is already listening on, so no `-p` flag is needed.

**Plugin options**

```js
devmirror({
  proxyPort:  9001,  // Port for the HTTP proxy (default: 9001)
  bridgePort: 9000,  // Port for the WebSocket bridge (default: 9000)
  noQr:       false, // Skip the QR code (default: false)
  host:       null,  // Override auto-detected LAN IP (default: auto)
})
```

