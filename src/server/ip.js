// Detects the machine's active LAN IPv4 address for use as the phone-accessible host.

import * as os from 'node:os';
import * as readline from 'node:readline';

import { isLinkLocal, isVirtualInterface } from './utils.js';
import { IPV4_PATTERN } from '../constant.js';
import { isEntryPoint, test } from '../utils.js';

/**
 * Collects all valid LAN IPv4 candidate addresses from the machine's
 * network interfaces, filtering out loopback, link-local, and virtual adapters.
 *
 * @returns {{ address: string, interfaceName: string }[]} Ordered list of candidates.
 */
function collectCandidates() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    if (isVirtualInterface(interfaceName)) continue;

    for (const entry of entries) {
      if (entry.family !== 'IPv4') continue;
      if (entry.internal) continue; // excludes 127.x.x.x
      if (isLinkLocal(entry.address)) continue;

      candidates.push({ address: entry.address, interfaceName });
    }
  }

  return candidates;
}

/**
 * Prompts the user to select one address from a numbered list of candidates
 * using an interactive readline prompt on stdin/stdout.
 *
 * @param {{ address: string, interfaceName: string }[]} candidates - The list to choose from.
 * @returns {Promise<string>} The IPv4 address the user selected.
 */
function promptUserToChoose(candidates) {
  return new Promise((resolve, reject) => {
    console.log('\n  Multiple network interfaces found:');
    candidates.forEach(({ address, interfaceName }, index) => {
      console.log(`    ${index + 1}. ${address} (${interfaceName})`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('  Enter number: ', (answer) => {
      rl.close();

      const choice = parseInt(answer.trim(), 10);

      if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
        reject(
          new Error(
            `[ip] Invalid selection: "${answer}". Enter a number between 1 and ${candidates.length}.`,
          ),
        );
        return;
      }

      resolve(candidates[choice - 1].address);
    });
  });
}

/**
 * Detects the active LAN IPv4 address of the current machine.
 *
 * Filters out loopback, link-local, and virtual/VPN interfaces.
 * If multiple candidates are found, prompts the user to pick one interactively.
 * If no candidates are found, throws with an actionable message.
 *
 * @param {string | null} hostOverride - If provided, skips detection and returns this value directly
 *   after validating that it looks like an IPv4 address.
 * @throws {Error} If `hostOverride` is provided but does not look like an IPv4 address.
 * @throws {Error} If no valid LAN IP candidates are found on the machine.
 * @returns {Promise<string>} The resolved LAN IP address.
 */
export async function detectLanIp(hostOverride) {
  if (hostOverride != null) {
    if (!IPV4_PATTERN.test(hostOverride)) {
      throw new Error(
        `[ip] Invalid --host value: "${hostOverride}". Expected a dotted-decimal IPv4 address (e.g. 192.168.1.10).`,
      );
    }
    return hostOverride;
  }

  const candidates = collectCandidates();

  if (candidates.length === 0) {
    throw new Error(
      'Could not detect a LAN IP address. Connect to a WiFi network or pass one manually: --host 192.168.x.x',
    );
  }

  if (candidates.length === 1) {
    return candidates[0].address;
  }

  // More than one candidate — let the user pick.
  return promptUserToChoose(candidates);
}

// ---------------------------------------------------------------------------
// Self-tests (run only when this file is executed directly)
// ---------------------------------------------------------------------------

if (isEntryPoint(import.meta.url)) {
  console.log('\n[ip] Running self-tests...\n');

  // Test 1 — a valid override is returned immediately without probing interfaces.
  await test('returns hostOverride when a valid IPv4 is provided', async () => {
    const result = await detectLanIp('192.168.1.42');
    if (result !== '192.168.1.42') {
      throw new Error(`Expected "192.168.1.42", got "${result}"`);
    }
  });

  // Test 2 — a non-IPv4 override is rejected.
  await test('throws for an invalid hostOverride value', async () => {
    try {
      await detectLanIp('not-an-ip');
      throw new Error('Expected detectLanIp("not-an-ip") to throw, but it did not');
    } catch (error) {
      if (!error.message.includes('[ip]')) throw error;
    }
  });

  // Test 3 — a hostname string (not dotted-decimal) is rejected.
  await test('throws for a hostname passed as hostOverride', async () => {
    try {
      await detectLanIp('localhost');
      throw new Error('Expected detectLanIp("localhost") to throw, but it did not');
    } catch (error) {
      if (!error.message.includes('[ip]')) throw error;
    }
  });

  // Test 4 — collectCandidates filters out the loopback address.
  await test('collectCandidates excludes loopback (127.x.x.x)', async () => {
    const candidates = collectCandidates();
    const hasLoopback = candidates.some(({ address }) => address.startsWith('127.'));
    if (hasLoopback) throw new Error('Loopback address found in candidates');
  });

  // Test 5 — collectCandidates excludes link-local addresses.
  await test('collectCandidates excludes link-local (169.254.x.x)', async () => {
    const candidates = collectCandidates();
    const hasLinkLocal = candidates.some(({ address }) => address.startsWith('169.254.'));
    if (hasLinkLocal) throw new Error('Link-local address found in candidates');
  });

  // Test 6 — null override triggers detection (returns a string or throws with the expected message).
  await test('proceeds to detection when hostOverride is null', async () => {
    try {
      const result = await detectLanIp(null);
      if (typeof result !== 'string') throw new Error(`Expected a string, got ${typeof result}`);
    } catch (error) {
      // Zero-candidates error is acceptable in CI/sandbox environments.
      if (!error.message.includes('Could not detect a LAN IP address')) throw error;
    }
  });

  console.log('\n[ip] Self-tests complete.\n');
}
