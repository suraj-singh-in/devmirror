// WebSocket bridge server that routes messages between the phone browser and the DevTools panel.

import { WebSocketServer, WebSocket } from 'ws';
import { isEntryPoint, test } from '../utils.js';

// Message types that flow from the phone → bridge → DevTools panel.
const PHONE_TO_DEVTOOLS_TYPES = new Set(['dimensions', 'console', 'touch', 'dom', 'styles', 'network_request_start', 'network_request_done', 'network_request_error']);

// Message types that flow from DevTools → bridge → phone.
const DEVTOOLS_TO_PHONE_TYPES = new Set(['request_dom', 'highlight', 'reload', 'request_styles']);

/**
 * Sends a JSON-serialised message to every open client in the given Set.
 * Clients whose connection is not yet open (or is closing/closed) are silently skipped.
 *
 * @param {Set<import('ws').WebSocket>} clients - The set of WebSocket connections to broadcast to.
 * @param {object} message - The message object to serialise and send.
 * @returns {void}
 */
function broadcast(clients, message) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Parses a raw WebSocket message buffer into a plain object.
 * Returns null if the data is not valid JSON or is not an object.
 *
 * @param {import('ws').RawData} data - The raw message data received by the WebSocket.
 * @returns {object | null}
 */
function parseMessage(data) {
  try {
    const parsed = JSON.parse(data.toString());
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Registers all event handlers for a newly connected client.
 *
 * Waits for the mandatory identify message to determine whether this client is
 * a phone or a DevTools panel, then routes all subsequent messages accordingly.
 *
 * @param {import('ws').WebSocket} socket - The newly connected WebSocket client.
 * @param {Set<import('ws').WebSocket>} phoneClients - Registry of phone connections.
 * @param {Set<import('ws').WebSocket>} devtoolsClients - Registry of DevTools connections.
 * @param {{ hadPhone: boolean }} flags - Mutable flags shared across all connections.
 * @returns {void}
 */
function handleConnection(socket, phoneClients, devtoolsClients, flags) {
  let role = null; // Set after the identify handshake.

  socket.once('message', (data) => {
    const message = parseMessage(data);

    // First message must be a valid identify frame.
    if (!message || message.type !== 'identify' || !['phone', 'devtools'].includes(message.role)) {
      console.log('[bridge] Connection rejected — missing or invalid identify message.');
      socket.close();
      return;
    }

    role = message.role;

    if (role === 'phone') {
      phoneClients.add(socket);
      console.log(`[bridge] Phone connected. Total phones: ${phoneClients.size}`);
      // Notify DevTools — use phone_reconnected if a phone has been seen before.
      const eventType = flags.hadPhone ? 'phone_reconnected' : 'phone_connected';
      flags.hadPhone = true;
      broadcast(devtoolsClients, { type: eventType });
    } else {
      devtoolsClients.add(socket);
      console.log(`[bridge] DevTools connected. Total devtools: ${devtoolsClients.size}`);
    }

    // Route all subsequent messages based on the client's role.
    socket.on('message', (subsequent) => {
      const msg = parseMessage(subsequent);
      if (!msg || !msg.type) return; // Ignore malformed frames silently.

      if (role === 'phone' && PHONE_TO_DEVTOOLS_TYPES.has(msg.type)) {
        broadcast(devtoolsClients, msg);
      } else if (role === 'devtools' && DEVTOOLS_TO_PHONE_TYPES.has(msg.type)) {
        broadcast(phoneClients, msg);
      } else {
        console.log(`[bridge] Unknown or misrouted message type: "${msg.type}" from ${role}.`);
      }
    });
  });

  socket.on('close', () => {
    if (role === 'phone') {
      phoneClients.delete(socket);
      console.log(`[bridge] Phone disconnected. Total phones: ${phoneClients.size}`);
      // Notify DevTools so it can show the reconnecting state.
      broadcast(devtoolsClients, { type: 'phone_disconnected' });
    } else if (role === 'devtools') {
      devtoolsClients.delete(socket);
      console.log(`[bridge] DevTools disconnected. Total devtools: ${devtoolsClients.size}`);
    }
    // If role is still null the connection was rejected before identify — nothing to clean up.
  });

  socket.on('error', (error) => {
    // Log but do not crash — the 'close' event fires after 'error' and handles cleanup.
    console.log(`[bridge] Socket error (role: ${role ?? 'unidentified'}): ${error.message}`);
  });
}

/**
 * Starts the WebSocket bridge server on the given port.
 *
 * Maintains two client registries — one for phone connections and one for
 * DevTools panel connections — and routes messages between them according to
 * the message type routing table in docs/TECHNICAL.md §2.4.
 *
 * @param {object} options
 * @param {number} options.bridgePort - Port for this WebSocket server to listen on.
 * @returns {Promise<{ server: import('ws').WebSocketServer, close: () => Promise<void> }>}
 */
export function startBridge({ bridgePort }) {
  return new Promise((resolve, reject) => {
    const phoneClients = new Set();
    const devtoolsClients = new Set();
    let hadPhone = false; // True once any phone has connected at least once.

    const server = new WebSocketServer({ port: bridgePort });

    server.on('connection', (socket) => {
      handleConnection(socket, phoneClients, devtoolsClients, { get hadPhone() { return hadPhone; }, set hadPhone(v) { hadPhone = v; } });
    });

    server.on('error', (error) => {
      console.log(`[bridge] Server error: ${error.message}`);
      reject(error);
    });

    server.once('listening', () => {
      console.log(`[bridge] Listening on port ${bridgePort}`);

      /**
       * Closes the WebSocket server and terminates all open connections.
       * Resolves once the server has fully shut down.
       *
       * @returns {Promise<void>}
       */
      function close() {
        return new Promise((resolveClose) => {
          // Terminate all open sockets immediately — ws.close() waits for them to finish naturally.
          for (const socket of server.clients) {
            socket.terminate();
          }
          server.close(() => resolveClose());
        });
      }

      resolve({ server, close });
    });
  });
}

// ---------------------------------------------------------------------------
// Self-tests (run only when this file is executed directly)
// ---------------------------------------------------------------------------

if (isEntryPoint(import.meta.url)) {
  const TEST_PORT = 19900;

  console.log('\n[bridge] Running self-tests...\n');

  // Test 1 — server starts and the promise resolves with a close handle.
  await test('starts a WebSocket server and resolves with { server, close }', async () => {
    const { server, close } = await startBridge({ bridgePort: TEST_PORT });
    if (!server) throw new Error('Expected server to be defined');
    if (typeof close !== 'function') throw new Error('Expected close to be a function');
    await close();
  });

  // Test 2 — a connection without an identify message is rejected.
  await test('rejects connections that do not send identify as first message', async () => {
    const { close } = await startBridge({ bridgePort: TEST_PORT + 1 });

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${TEST_PORT + 1}`);
      socket.once('open', () => socket.send(JSON.stringify({ type: 'hello' })));
      // The server should close the socket — we expect a 'close' event.
      socket.once('close', resolve);
      socket.once('error', reject);
    });

    await close();
  });

  // Test 3 — phone → devtools routing: a dimensions message reaches the DevTools client.
  await test('routes dimensions from phone to devtools', async () => {
    const { close } = await startBridge({ bridgePort: TEST_PORT + 2 });
    const url = `ws://127.0.0.1:${TEST_PORT + 2}`;

    const received = await new Promise((resolve, reject) => {
      const devtools = new WebSocket(url);
      devtools.once('open', () => {
        devtools.send(JSON.stringify({ type: 'identify', role: 'devtools' }));

        const phone = new WebSocket(url);
        phone.once('open', () => {
          phone.send(JSON.stringify({ type: 'identify', role: 'phone' }));
          // Give the server a tick to process identify before sending the payload.
          setTimeout(() => {
            phone.send(JSON.stringify({ type: 'dimensions', width: 390, height: 844 }));
          }, 20);
        });
        phone.once('error', reject);
      });

      devtools.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        // Skip the phone_connected notification; wait for the real payload.
        if (msg.type === 'dimensions') resolve(msg);
      });
      devtools.once('error', reject);
    });

    if (received.width !== 390) throw new Error(`Expected width 390, got ${received.width}`);
    await close();
  });

  // Test 4 — devtools → phone routing: a reload message reaches the phone client.
  await test('routes reload from devtools to phone', async () => {
    const { close } = await startBridge({ bridgePort: TEST_PORT + 3 });
    const url = `ws://127.0.0.1:${TEST_PORT + 3}`;

    const received = await new Promise((resolve, reject) => {
      const phone = new WebSocket(url);
      phone.once('open', () => {
        phone.send(JSON.stringify({ type: 'identify', role: 'phone' }));

        const devtools = new WebSocket(url);
        devtools.once('open', () => {
          devtools.send(JSON.stringify({ type: 'identify', role: 'devtools' }));
          setTimeout(() => {
            devtools.send(JSON.stringify({ type: 'reload' }));
          }, 20);
        });
        devtools.once('error', reject);
      });

      phone.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'reload') resolve(msg);
      });
      phone.once('error', reject);
    });

    if (received.type !== 'reload') throw new Error(`Expected type "reload", got "${received.type}"`);
    await close();
  });

  // Test 5 — phone_disconnected is sent to DevTools when the phone closes.
  await test('notifies devtools with phone_disconnected when phone drops', async () => {
    const { close } = await startBridge({ bridgePort: TEST_PORT + 4 });
    const url = `ws://127.0.0.1:${TEST_PORT + 4}`;

    const received = await new Promise((resolve, reject) => {
      const devtools = new WebSocket(url);
      devtools.once('open', () => {
        devtools.send(JSON.stringify({ type: 'identify', role: 'devtools' }));

        const phone = new WebSocket(url);
        phone.once('open', () => {
          phone.send(JSON.stringify({ type: 'identify', role: 'phone' }));
          // Close the phone after identify has been processed.
          setTimeout(() => phone.close(), 30);
        });
        phone.once('error', reject);
      });

      devtools.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'phone_disconnected') resolve(msg);
      });
      devtools.once('error', reject);
    });

    if (received.type !== 'phone_disconnected') {
      throw new Error(`Expected phone_disconnected, got "${received.type}"`);
    }
    await close();
  });

  console.log('\n[bridge] Self-tests complete.\n');
}
