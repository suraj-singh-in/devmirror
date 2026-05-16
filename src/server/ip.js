// Detects the machine's active LAN IPv4 address for use as the phone-accessible host.

/**
 * Detects the active LAN IPv4 address of the current machine.
 *
 * Filters out loopback, link-local, and virtual/VPN interfaces.
 * If multiple candidates are found, prompts the user to pick one.
 * If no candidates are found, throws an actionable error.
 *
 * @param {string | null} hostOverride - If provided, skips detection and returns this value directly.
 * @returns {Promise<string>} The resolved LAN IP address.
 */
export async function detectLanIp(hostOverride) {}
