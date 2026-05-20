import dgram from 'node:dgram';
import dns   from 'node:dns';

/**
 * Patches Node's dns.lookup so that `hostname` resolves to 127.0.0.1
 * within this process only — no system hosts file edit required.
 * Affects all outgoing TCP connections (http.request, net.connect, etc.).
 *
 * @param {string} hostname
 */
export function patchLocalLookup(hostname) {
  const target  = hostname.toLowerCase();
  const _lookup = dns.lookup.bind(dns);
  dns.lookup = function (host, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (host.toLowerCase() === target) {
      const reqFamily = typeof options === 'number' ? options : (options?.family ?? 0);
      const family    = reqFamily === 6 ? 6 : 4;
      const address   = family === 6 ? '::1' : '127.0.0.1';
      // Node 21+ (Happy Eyeballs) calls with { all: true } and expects an array.
      if (options && options.all) {
        setImmediate(() => callback(null, [{ address, family }]));
      } else {
        setImmediate(() => callback(null, address, family));
      }
      return;
    }
    return _lookup(host, options, callback);
  };
}

const UPSTREAM_PORT    = 53;
const FORWARD_TIMEOUT  = 3000;

/**
 * Parse a DNS QNAME starting at `offset` in `msg`.
 * Returns the decoded hostname in lowercase.
 */
function parseName(msg, offset) {
  let name = '';
  let i    = offset;
  while (i < msg.length && msg[i] !== 0) {
    const len = msg[i++];
    if (name) name += '.';
    name += msg.subarray(i, i + len).toString('ascii');
    i += len;
  }
  return name.toLowerCase();
}

/**
 * Build a minimal A-record DNS response for the given query buffer.
 * `ip` must be a dotted-decimal IPv4 string, e.g. '192.168.1.12'.
 */
function buildAResponse(query, ip) {
  const ipBytes = ip.split('.').map(Number);
  const rr = Buffer.from([
    0xc0, 0x0c,              // name pointer → QNAME at offset 12
    0x00, 0x01,              // TYPE  A
    0x00, 0x01,              // CLASS IN
    0x00, 0x00, 0x01, 0x2c, // TTL   300 s
    0x00, 0x04,              // RDLENGTH 4
    ...ipBytes,
  ]);

  const header = Buffer.from(query.subarray(0, query.length));
  header[2] = (header[2] | 0x80) & 0xff; // QR = 1 (response)
  header[3] = header[3] & 0xf0;          // RCODE = 0, RA = 0
  header.writeUInt16BE(1, 6);            // ANCOUNT = 1

  return Buffer.concat([header, rr]);
}

/**
 * Forward a DNS message to the upstream resolver and relay the reply
 * back to the original requester via `server`.  Times out after
 * FORWARD_TIMEOUT ms and drops the query silently.
 */
function forward(msg, upstream, rinfo, server) {
  const sock = dgram.createSocket('udp4');
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { sock.close(); } catch { /* already closed */ }
  }, FORWARD_TIMEOUT);

  sock.once('message', (reply) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { sock.close(); } catch { /* already closed */ }
    server.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) console.log(`[dns] relay error: ${err.message}`);
    });
  });

  sock.once('error', (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { sock.close(); } catch { /* already closed */ }
    console.log(`[dns] upstream error: ${err.message}`);
  });

  sock.send(msg, UPSTREAM_PORT, upstream);
}

/**
 * Start a minimal UDP DNS server that:
 *  - Answers A-record queries for `hostname` with `address`.
 *  - Forwards all other queries to `upstream` (default 8.8.8.8).
 *  - Binds to `address:53` (not 0.0.0.0) to avoid clashing with the
 *    OS DNS client service which typically holds 127.0.0.1:53.
 *
 * Rejects with EACCES if the process lacks privilege for port 53, or
 * EADDRINUSE if something else already holds that address/port.
 *
 * @param {{ hostname: string, address: string, upstream?: string }}
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export function startDns({ hostname, address, upstream = '8.8.8.8' }) {
  return new Promise((resolve, reject) => {
    const server = dgram.createSocket('udp4');
    const target = hostname.toLowerCase();
    let bound    = false;

    server.on('error', (err) => {
      if (!bound) {
        reject(err);
      } else {
        console.log(`[dns] server error: ${err.message}`);
      }
    });

    server.on('message', (msg, rinfo) => {
      if (msg.length < 12) return;
      const name = parseName(msg, 12);
      if (name === target) {
        const response = buildAResponse(msg, address);
        server.send(response, rinfo.port, rinfo.address, (err) => {
          if (err) console.log(`[dns] send error: ${err.message}`);
        });
      } else {
        forward(msg, upstream, rinfo, server);
      }
    });

    server.bind(53, address, () => {
      bound = true;
      resolve({
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}
