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

## Definition of done

All rows in all tables above pass without console errors in the DevTools browser
window. The phone's actual screen dimensions appear in the Device tab and the
Touch tab canvas matches the phone's portrait aspect ratio.
