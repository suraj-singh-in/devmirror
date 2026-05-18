# devmirror v0.2 — Verification Steps

Manual test plan for all v0.2 features. Run through this checklist after any
significant change to `src/devtools/` or `src/server/`.

## Setup

1. Start your dev server on any port, e.g. `npx serve . -p 3000`.
2. In a second terminal, start devmirror:
   ```
   node bin/cli.js -p 3000
   ```
3. The terminal prints three URLs:
   - **Phone URL** — e.g. `http://192.168.x.x:9001` — open this on the phone.
   - **DevTools** — e.g. `http://localhost:9001/__devtools` — opens automatically in your browser.
4. Scan the QR code in the terminal with the phone camera, or type the Phone URL manually.

> **Prerequisites:** Phone and laptop must be on the same WiFi network.
> Node ≥ 18 required.

---

## 1. Connection states

| Step | Expected result |
|------|----------------|
| DevTools open, phone not yet connected | Pill reads "Waiting for device…", logo dot is grey, reconnect bar hidden, all three tabs show "Waiting for phone" empty state |
| Phone opens the Phone URL | Pill updates to "412 × 915 · 2.6×" (your device's actual values), logo dot turns green, Reload and Disconnect buttons become enabled, Device tab populates |
| Kill the phone tab (or navigate away) | Pill shows device info + "(disconnected)", logo dot turns amber, reconnect bar appears below tab bar with amber background |
| Re-open the Phone URL on the phone | Reconnect bar disappears, dot turns green, all tabs resume normally |

---

## 2. Device tab

1. Connect the phone.
2. Click the **Device** tab.

| Field | Expected value |
|-------|---------------|
| Screen | Physical resolution, e.g. `412 × 915` |
| Viewport | CSS viewport, e.g. `411 × 784` |
| DPR | Device pixel ratio, e.g. `2.625×` |
| OS / Browser | e.g. `Android 10 · Chrome` |
| User Agent | Full UA string in monospace, word-wrapping |

3. Verify that opening the Phone URL in a desktop browser (laptop) does **not**
   replace the phone's data — only the phone's dimensions appear.

---

## 3. Console tab

### 3a. Receiving logs

1. Open your dev server's app on the phone.
2. In the proxied app's HTML or via the browser console, trigger:
   ```js
   console.log('hello devmirror');
   console.warn('a warning');
   console.error('an error');
   ```
3. In the DevTools Console tab, the sidebar should list all three entries with
   correct level badges (LOG, WARN, ERROR) and timestamps.
4. Click a log entry — the detail pane shows the full message, level chip,
   timestamp chip, and (if an Error object) a stack trace section.

### 3b. Filter pills

1. Click **Warn** pill — only warn-level entries remain visible.
2. Click **Error** pill — only error entries visible.
3. Click **All** — all entries return.
4. Type in the search box — list filters to matching entries in real time.
5. Clear the search — all entries (within active filter) return.

### 3c. Preserve logs toggle

1. Leave the toggle **off** (default).
2. Reload the phone tab — the console list clears.
3. Trigger a new log entry.
4. Enable the **Preserve logs** toggle (turns green).
5. Reload the phone tab — the log list is **not** cleared; the new entry is appended.

### 3d. Clear button

1. With some logs in the list, click the trash icon.
2. The log list empties; the detail pane returns to the "Select a log entry" state.

---

## 4. Touch tab

1. Click the **Touch** tab.
2. While connected, the canvas area shows a portrait-shaped outline matching the
   phone's screen aspect ratio, centered in the available space.
3. Tap the phone screen several times in different locations.
4. Verify:
   - Coloured blobs appear at the tap positions (permanent heatmap layer).
   - A brief fade-out animation plays on each tap (fade layer).
   - Tap positions are correctly scaled to the phone's viewport.
5. Click **Clear heatmap** — all blobs disappear.
6. Resize the DevTools browser window — the canvas recentres and re-scales to fit.

> **Expected canvas shape:** portrait (taller than wide) for a typical phone held
> upright. If the DevTools window is narrow, the canvas fills the height and is
> centred horizontally.

---

## 5. Tab badge

1. While on the **Device** tab, trigger several `console.log` calls on the phone.
2. The **Console** tab label gains a badge showing the unread count (e.g. `3`).
3. Trigger 100+ logs — badge shows `99+`.
4. Click the Console tab — badge disappears immediately.
5. Screen reader check: the Console tab's `aria-label` should read
   `"Console, N unread logs"` while the badge is visible, and `"Console"` after
   switching to it.

---

## 6. Accessibility spot-checks

| Check | Pass condition |
|-------|---------------|
| Tab keyboard navigation | Tab key moves focus through tabs; Enter/Space activates |
| Filter pill keyboard | Arrow keys cycle through pills; selected pill has `aria-checked="true"` |
| Preserve logs toggle | Space bar toggles it; `aria-checked` flips between `"true"` and `"false"` |
| Connection state announcement | Screen reader announces "Phone connected: 412 × 915 · 2.6×" after dimensions arrive (not "Waiting for device…") |
| Disconnection announcement | Screen reader announces "Phone disconnected — attempting to reconnect" |
| Icon-only buttons | Reload and Disconnect buttons have descriptive `aria-label`; trash icon button has `aria-label="Clear logs"` |
| Decorative icons | All `<i>` icons have `aria-hidden="true"` |

---

## 7. Reconnect bar (§10.3)

1. Connect the phone.
2. Close the phone tab (or kill network).
3. Verify: amber bar appears immediately below the tab bar, reading
   "Reconnecting…" (or similar reconnect message). It does not overlap tab content.
4. Re-open the phone URL.
5. Verify: bar disappears and the logo dot turns green.

---

## 8. --target-host / --target-https flags

### 8a. Default behaviour unchanged

Run without any new flags:
```
node bin/cli.js -p 3000
```
Confirm startup shows `Proxying: http://localhost:3000`. App loads on phone. No regression.

### 8b. Custom HTTP host

Add `127.0.0.1 devmirror-test.local` to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows, `/etc/hosts` on Mac/Linux).

Run:
```
node bin/cli.js -p 5173 --target-host devmirror-test.local
```

| Check | Expected |
|-------|----------|
| Startup line | `Proxying: http://devmirror-test.local:5173` |
| App loads on phone | Yes — via QR code |
| No CORS errors | Confirm with a fetch/XHR from the app |

### 8c. Custom HTTPS host with self-signed cert

Run your dev server with HTTPS on `devmirror-test.local:5173`, then:
```
node bin/cli.js -p 5173 --target-host devmirror-test.local --target-https
```

| Check | Expected |
|-------|----------|
| Warning line | `! --target-https: TLS certificate verification is disabled for the proxy target.` |
| Startup line | `Proxying: https://devmirror-test.local:5173  (cert verification off)` |
| No TLS errors | App loads on phone without certificate errors |
| Origin header | `https://devmirror-test.local:5173` (verify via API call) |

### 8d. --target-https without --target-host

Run:
```
node bin/cli.js -p 5173 --target-https
```
Confirm startup shows `Proxying: https://localhost:5173  (cert verification off)`.
Valid use case for developers running localhost HTTPS.

### 8e. HMR still works with custom host

With `--target-host` and `--target-https` set, edit a source file.
Confirm the phone browser updates without a full reload.

### 8f. Protocol stripping warning

Run:
```
node bin/cli.js -p 5173 --target-host http://localdev.uat.company.com
```
Confirm:
- Warning: `! --target-host should be a hostname only, not a URL. Using: localdev.uat.company.com`
- Protocol is stripped and proxy targets `localdev.uat.company.com:5173`.

### 8g. IP address rejection

Run:
```
node bin/cli.js -p 5173 --target-host 192.168.1.5
```
Confirm:
- Error: `✗ --target-host is for custom local domain names, not IP addresses. Use --host for IP overrides.`
- Process exits with code 1.

---

## Known limitations

### --target-host: client-side hostname guards

If your app redirects based on hostname (e.g. checks `window.location.hostname`
and redirects to the canonical domain), the phone will be redirected to a URL
it cannot resolve. Disable that guard in your local dev config when testing
with devmirror.

---

## 9. Network tab

### 9a. GET request appears instantly

1. Connect the phone. Open the proxied app — it makes a fetch call on load.
2. Switch to the **Network** tab.

| Check | Expected |
|-------|----------|
| Row appears | Green dot, GET badge, path (e.g. `/api/user`), duration in ms, size in kB |
| Click the row | Detail pane shows full URL, status chip, duration, size, content-type chips |
| Request Headers sub-tab | Shows headers sent with the request |
| Response Headers sub-tab | Shows headers returned by the server |
| Response sub-tab | Shows response body (prettified JSON if `application/json`) |

### 9b. POST request — Payload sub-tab

1. Trigger a form submission or login from the phone.
2. Click the POST row in the Network tab.

| Check | Expected |
|-------|----------|
| Payload sub-tab visible | Tab appears (hidden for GET/DELETE without body) |
| Payload content | Request body shown (JSON prettified, form-data as key/value table) |

### 9c. Error request (4xx / 5xx)

1. From the phone, call a non-existent API endpoint.

| Check | Expected |
|-------|----------|
| Row dot colour | Red |
| Errors filter pill | Shows only this row when active |
| Status chip in detail | Red colour, e.g. `✗ 404 Not Found` |

### 9d. Pending request indicator

1. From the phone, trigger a slow request (or throttle the dev server).

| Check | Expected |
|-------|----------|
| While in-flight | Amber dot, size column reads "pending" in amber |
| After completion | Dot updates to green/red, size and duration populate |

### 9e. Filter pills

Load a page that fetches JS, CSS, and JSON API data from the phone.

| Pill | Expected rows |
|------|---------------|
| All | All requests |
| Fetch | Only fetch/JSON requests |
| XHR | Only XHR requests |
| JS | Only `.js` file requests |
| CSS | Only `.css` file requests |
| Errors | Only 4xx/5xx or network-error requests |

### 9f. URL search

1. Type `/api` in the sidebar search box.
2. Confirm only rows whose URL contains `/api` are shown.
3. Clear the search — all requests (within active filter) return.

### 9g. Detail search — Request Headers

1. Select any request. Click **Request Headers** sub-tab.
2. Type `content` in the detail search box.
3. Confirm only header rows whose key or value contains "content" are shown.
4. Confirm the matched text is highlighted in amber.
5. Result count shows `N of M results`.
6. Click × — search clears, all rows return.

### 9h. Detail search — Response body

1. Select a JSON API request. Click **Response** sub-tab.
2. Type a key from the JSON (e.g. `email`).
3. Confirm only matching lines are shown and highlighted.

### 9i. Image preview

1. Load a page that fetches an image.
2. Click the image request row. Click **Preview**.
3. Confirm the "Image response — Preview not available" empty state appears.
4. Confirm search bar is hidden on the Preview tab for images.

### 9j. Timing sub-tab

1. Select any completed request. Click **Timing**.
2. If `PerformanceResourceTiming` data is available: confirm DNS, Connecting, SSL/TLS, Waiting (TTFB), and Receiving rows with coloured bars and ms values. TOTAL section shows overall duration.
3. If data is unavailable (e.g. cross-origin): confirm "Timing data not available" empty state.
4. Confirm the search bar is hidden on the Timing tab.

### 9k. Preserve requests toggle

1. Leave toggle **off** (default).
2. Reload the phone tab — the request list clears.
3. Enable **Preserve requests** toggle (turns green).
4. Reload the phone tab — the request list is **not** cleared; new requests are appended.

### 9l. Clear button

1. With some requests in the list, click the trash icon.
2. The request list empties and the detail pane returns to "Select a request" state.

### 9m. Tab badge

1. While on the **Device** tab, trigger several requests on the phone.
2. The **Network** tab label gains a green badge showing the unread count.
3. Click the Network tab — badge disappears.

---

## Definition of done

All rows in all tables above pass without console errors in the DevTools browser
window. The phone's actual screen dimensions appear in the Device tab and the
Touch tab canvas matches the phone's portrait aspect ratio.
