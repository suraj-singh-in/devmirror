// Utility for finding a free TCP port, starting from a preferred port and auto-incrementing on collision.

import * as net from 'node:net';
import { isEntryPoint, test } from '../utils.js';

const MAX_PORT = 65535;
const MAX_ATTEMPTS = 20;

/**
 * Attempts to bind a TCP server on the given port to test availability.
 * Closes the server immediately after a successful bind.
 *
 * @param {number} port - The port to probe.
 * @returns {Promise<boolean>} True if the port is free, false if it is in use.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      // EADDRINUSE or similar — port is not free.
      resolve(false);
    });

    server.once('listening', () => {
      // Successfully bound — port is free. Close before returning.
      server.close(() => resolve(true));
    });

    // Bind on all interfaces (0.0.0.0) so the check matches real bind behaviour.
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Finds a free TCP port, starting at `preferredPort` and incrementing by one
 * on each collision until a free port is found or MAX_ATTEMPTS is exhausted.
 *
 * @param {number} preferredPort - The port to try first. Must be between 1 and 65535.
 * @throws {Error} If `preferredPort` is 0 or not a positive integer.
 * @throws {Error} If `preferredPort` is above 65535.
 * @throws {Error} If no free port is found within MAX_ATTEMPTS attempts.
 * @returns {Promise<number>} The first available port >= preferredPort.
 */
export async function findFreePort(preferredPort) {
  if (!Number.isInteger(preferredPort) || preferredPort < 1) {
    throw new Error(
      `[ports] Invalid port: ${preferredPort}. Port must be a positive integer (1–65535).`,
    );
  }

  if (preferredPort > MAX_PORT) {
    throw new Error(
      `[ports] Invalid port: ${preferredPort}. Port must not exceed ${MAX_PORT}.`,
    );
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = preferredPort + attempt;

    if (candidate > MAX_PORT) {
      throw new Error(
        `[ports] Could not find a free port — reached the maximum port number (${MAX_PORT}) after ${attempt} attempts.`,
      );
    }

    const free = await isPortFree(candidate);
    if (free) {
      return candidate;
    }
  }

  throw new Error(
    `[ports] Could not find a free port after ${MAX_ATTEMPTS} attempts starting from port ${preferredPort}. ` +
      `Free up a port in the range ${preferredPort}–${preferredPort + MAX_ATTEMPTS - 1} and try again.`,
  );
}

// ---------------------------------------------------------------------------
// Self-tests (run only when this file is executed directly)
// ---------------------------------------------------------------------------

if (isEntryPoint(import.meta.url)) {
  console.log('\n[ports] Running self-tests...\n');

  // Test 1 — a clearly uncontested port returns a valid port number.
  await test('returns a free port for a valid preferred port', async () => {
    const port = await findFreePort(19876);
    if (typeof port !== 'number') throw new Error(`Expected a number, got ${typeof port}`);
    if (port < 19876) throw new Error(`Expected port >= 19876, got ${port}`);
  });

  // Test 2 — when the preferred port is occupied, a different (incremented) port is returned.
  await test('returns the next free port when the preferred port is in use', async () => {
    // Occupy a port by holding a server open.
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(19877, '0.0.0.0', resolve));

    try {
      const port = await findFreePort(19877);
      if (port === 19877) throw new Error(`Expected a port other than 19877, got ${port}`);
      if (port <= 19877) throw new Error(`Expected port > 19877, got ${port}`);
    } finally {
      // Always release the blocker, even if the assertion fails.
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  // Test 3 — port 0 is rejected immediately.
  await test('throws for port 0', async () => {
    try {
      await findFreePort(0);
      throw new Error('Expected findFreePort(0) to throw, but it did not');
    } catch (error) {
      if (!error.message.includes('[ports]')) throw error;
    }
  });

  // Test 4 — ports above 65535 are rejected immediately.
  await test('throws for port above 65535', async () => {
    try {
      await findFreePort(65536);
      throw new Error('Expected findFreePort(65536) to throw, but it did not');
    } catch (error) {
      if (!error.message.includes('[ports]')) throw error;
    }
  });

  console.log('\n[ports] Self-tests complete.\n');
}
