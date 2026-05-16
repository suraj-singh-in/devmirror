// Interface name prefixes that identify virtual, VPN, or container adapters.
// These are never valid LAN interfaces for devmirror's purposes.
export const VIRTUAL_INTERFACE_PREFIXES = ['docker', 'br-', 'veth', 'vmnet', 'utun', 'tun', 'tap', 'lo'];

// Matches a standard dotted-decimal IPv4 address.
export const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

