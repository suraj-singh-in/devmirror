# Contributing to devmirror

Thanks for your interest in contributing. This document covers how to get set up, how to test, and what to expect from the review process.

---

## Getting started

**Prerequisites:** Node 18+, git.

```sh
git clone https://github.com/suraj-singh/devmirror.git
cd devmirror
npm install
```

There is no build step. Source runs directly with `node`.

---

## Running locally

You need two things running: a dev server to proxy, and devmirror itself.

**1. Start any dev server on a port:**

```sh
# Example: a simple static server
npx serve . -p 3000

# Or your actual project
npm run dev   # Vite, Next.js, CRA, etc.
```

**2. Run devmirror against it:**

```sh
node bin/cli.js -p 3000
```

The terminal prints:
- A **Phone URL** to open on your phone (`http://192.168.x.x:9001`)
- A **DevTools URL** that auto-opens in your laptop browser (`http://localhost:9001/__devtools`)

Both must be reachable — your phone and laptop need to be on the same WiFi network.

---

## Testing without a real phone

You can simulate the phone in a desktop browser tab for most development work.

**1. Open the Phone URL in a second browser tab** (same machine):

```
http://localhost:9001
```

This tab acts as the "phone". The bridge script connects and starts forwarding data.

**2. Open browser DevTools on the phone tab** and run:

```js
console.log('test log');
console.warn('test warning');
console.error('test error');
```

These appear instantly in the DevTools panel's Console tab.

**3. Simulating touch events** (the Touch tab):

```js
// Dispatch synthetic touch events
var el = document.body;
var touch = new Touch({ identifier: 1, target: el, clientX: 150, clientY: 300 });
var event = new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true });
el.dispatchEvent(event);
```

**4. DOM inspection** — click "Snapshot DOM" in the DOM tab while the phone tab is open. It captures the DOM of whatever page the phone tab is showing.

> Note: `screen.width` / `screen.height` in a desktop browser tab will report laptop dimensions rather than phone dimensions, so the Device tab will show laptop values in this mode. That's expected — it is a simulation.

---

## Project structure

```
bin/
  cli.js                  Entry point — argument parsing, startup orchestration
src/
  server/
    proxy.js              HTTP proxy server + DevTools page assembly
    bridge.js             WebSocket bridge message router
    ip.js                 LAN IP detection
    ports.js              Free port finding
  client/
    bridge.js             Phone bridge script (injected into every page)
  devtools/
    index.html            DevTools panel shell + all JavaScript
    style.css             Global panel styles and design tokens
    components/tabs/      Per-tab HTML and CSS
      device/
      console/
      touch/
      dom/
  plugins/
    vite.js               Vite plugin (importable as devmirror/vite)
docs/                     Design documents — PRD, ROADMAP, TECHNICAL, DESIGN
```

---

## Code style

- **No TypeScript** — plain JavaScript throughout. JSDoc for function signatures where useful.
- **No framework** — vanilla JS in the DevTools panel and bridge script. No React, no Vue, no bundler.
- **No comments explaining what the code does** — name things well instead. Comments are for *why*: hidden constraints, workarounds, non-obvious invariants.
- **No error handling for things that cannot fail** — trust internal code and Node.js guarantees. Validate only at system boundaries (CLI args, incoming WebSocket messages, external file reads).
- **No premature abstractions** — three similar lines of code is better than a helper function that only saves three lines.
- **ES modules throughout** — `"type": "module"` is set in `package.json`. Use `import`/`export`.
- **Bridge script exception** — `src/client/bridge.js` must remain ES5-compatible (no arrow functions, no `const`/`let` at the top-level IIFE scope) so it runs on older phone browsers without transpilation.

---

## Running the test checklist

There are no automated tests yet. The manual verification steps are in [TESTING.md](./TESTING.md).

Before opening a PR, run through the sections relevant to your change:
- Section 1 (connection states) for any proxy or bridge changes
- Section 2 (Device tab) for changes to dimension handling
- Section 3 (Console tab) for console-related changes
- Section 4 (Touch tab) for touch-related changes
- Section 5 (Tab badge) for any tab or counter changes
- Section 7 (Reconnect bar) for connection state changes

---

## Opening a pull request

1. **Fork** the repo and create a branch from `master`.
2. **Make your changes** — keep each PR focused on one thing.
3. **Run through the relevant TESTING.md checks** before submitting.
4. **Write a clear PR description**: what changed, why, and how to test it.
5. **Open the PR** against `master`.

For significant features or design changes, open an issue first to discuss the approach. This avoids wasted effort on work that might not fit the project's direction.

---

## What to work on

Check the [ROADMAP.md](./docs/ROADMAP.md) for what is planned. Items in the **backlog / future** section are fair game — open an issue to claim one before starting so work isn't duplicated.

The highest-value unbuilt features right now:
- `--tunnel` flag (ngrok integration for cross-network use)
- Camera tab (live feed from phone camera)
- Multi-device support

---

## Questions

Open a GitHub issue with the `question` label.
