
import { VIRTUAL_INTERFACE_PREFIXES } from '../constant.js';

/**
 * Returns true if the given interface name belongs to a virtual or VPN adapter
 * that should be excluded from LAN IP candidates.
 *
 * @param {string} interfaceName - The OS-level network interface name (e.g. 'en0', 'docker0').
 * @returns {boolean}
 */
export function isVirtualInterface(interfaceName) {
  const lower = interfaceName.toLowerCase();
  return VIRTUAL_INTERFACE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Returns true if the given IPv4 address is link-local (169.254.x.x).
 * Link-local addresses are self-assigned and are not routable on the LAN.
 *
 * @param {string} address - A dotted-decimal IPv4 address string.
 * @returns {boolean}
 */
export function isLinkLocal(address) {
  return address.startsWith('169.254.');
}
