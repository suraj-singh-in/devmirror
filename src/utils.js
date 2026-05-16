// Shared utilities used across server modules.

import { pathToFileURL } from 'node:url';

/**
 * Returns true when the calling module is the Node.js entry point (i.e. run
 * directly via `node <file>`, not imported by another module).
 *
 * Used to guard self-tests so they never execute during normal usage.
 *
 * @param {string} metaUrl - Pass `import.meta.url` from the calling module.
 * @returns {boolean}
 */
export function isEntryPoint(metaUrl) {
  // process.argv[1] is undefined when Node runs with -e, so return false early.
  if (!process.argv[1]) return false;
  const runFile = pathToFileURL(process.argv[1]).href;
  return runFile === metaUrl;
}

/**
 * Runs a single named test. Logs PASS or FAIL with the reason on failure.
 *
 * Intended for use in self-test blocks guarded by `isEntryPoint()`.
 * No external test framework required.
 *
 * @param {string} name - Human-readable test description.
 * @param {() => Promise<void>} fn - Async test body. Throw to signal failure.
 * @returns {Promise<void>}
 */
export async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}
