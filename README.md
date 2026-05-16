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

